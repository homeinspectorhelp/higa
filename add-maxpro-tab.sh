#!/bin/bash
cd /var/www/higa-dashboard

# Insert Max Pro nav item before the System section label
sed -i '/<div class="nav-section-label">System<\/div>/i\    <div class="nav-section-label">AI</div>\n    <div class="nav-item" onclick="showPage('\''maxpro'\'', this)">\n      <span class="nav-icon">🤖</span> Max Pro\n    </div>' dashboard/index.html

# Insert Max Pro chat page before the closing </div><!-- /content -->
sed -i '/<\/div><!-- \/content -->/i\    <!-- ── MAX PRO ── -->\n    <div class="page" id="page-maxpro">\n      <div style="display:flex;flex-direction:column;height:calc(100vh - 60px);">\n        <div style="padding:1rem 0;display:flex;align-items:center;gap:1rem;">\n          <div style="width:40px;height:40px;border-radius:50%;background:rgba(201,168,76,0.15);border:2px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🤖</div>\n          <div>\n            <div style="font-weight:700;color:var(--text);font-size:1rem;">Max Pro</div>\n            <div style="font-size:0.75rem;color:var(--green);">● Online · HIGA AI Orchestrator</div>\n          </div>\n          <div style="margin-left:auto;font-size:0.75rem;color:var(--muted);" id="max-status">Idle</div>\n        </div>\n        <div id="max-messages" style="flex:1;overflow-y:auto;padding:1rem 0;display:flex;flex-direction:column;gap:0.75rem;"></div>\n        <div style="display:flex;gap:0.5rem;padding:1rem 0;">\n          <textarea id="max-input" rows="2" placeholder="Message Max Pro..." style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.75rem;color:var(--text);font-size:0.875rem;font-family:inherit;resize:none;outline:none;"></textarea>\n          <button id="max-send" onclick="maxSend()" style="padding:0 1.5rem;background:var(--gold);color:#080F1C;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.875rem;">Send</button>\n        </div>\n      </div>\n    </div>' dashboard/index.html

# Add maxpro to pageTitles
sed -i "s/settings: 'Settings'/settings: 'Settings',\n    maxpro: 'Max Pro'/" dashboard/index.html

# Insert Max Pro chat JavaScript before </script>
sed -i '/<\/script>/i\
  var maxHistory = JSON.parse(localStorage.getItem("maxHistory") || "[]");\
  var maxBusy = false;\
  function maxRender() {\
    var c = document.getElementById("max-messages");\
    c.innerHTML = "";\
    maxHistory.forEach(function(m) {\
      var d = document.createElement("div");\
      d.style.cssText = m.role === "user" ? "align-self:flex-end;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.3);border-radius:12px 12px 2px 12px;padding:0.75rem 1rem;max-width:75%;color:var(--text);font-size:0.875rem;white-space:pre-wrap;" : "align-self:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:12px 12px 12px 2px;padding:0.75rem 1rem;max-width:85%;color:var(--text);font-size:0.875rem;white-space:pre-wrap;line-height:1.6;";\
      d.textContent = typeof m.content === "string" ? m.content : m.content.map(function(b){return b.text||""}).join("");\
      c.appendChild(d);\
    });\
    c.scrollTop = c.scrollHeight;\
  }\
  function maxSend() {\
    if (maxBusy) return;\
    var inp = document.getElementById("max-input");\
    var txt = inp.value.trim();\
    if (!txt) return;\
    inp.value = "";\
    maxHistory.push({ role: "user", content: txt });\
    maxRender();\
    maxBusy = true;\
    document.getElementById("max-status").textContent = "Thinking...";\
    document.getElementById("max-status").style.color = "var(--gold)";\
    var assistantText = "";\
    var msgDiv = document.createElement("div");\
    msgDiv.style.cssText = "align-self:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:12px 12px 12px 2px;padding:0.75rem 1rem;max-width:85%;color:var(--text);font-size:0.875rem;white-space:pre-wrap;line-height:1.6;";\
    document.getElementById("max-messages").appendChild(msgDiv);\
    fetch("/api/max-pro/chat", {\
      method: "POST",\
      headers: { "Content-Type": "application/json" },\
      body: JSON.stringify({ messages: maxHistory.filter(function(m){return m.role==="user"||m.role==="assistant"}) })\
    }).then(function(res) {\
      var reader = res.body.getReader();\
      var decoder = new TextDecoder();\
      var buf = "";\
      function read() {\
        reader.read().then(function(result) {\
          if (result.done) { finish(); return; }\
          buf += decoder.decode(result.value, { stream: true });\
          var lines = buf.split("\\n");\
          buf = lines.pop();\
          var evtType = "";\
          lines.forEach(function(line) {\
            if (line.startsWith("event: ")) evtType = line.slice(7);\
            else if (line.startsWith("data: ") && evtType === "text") {\
              try {\
                var d = JSON.parse(line.slice(6));\
                if (d.delta) { assistantText += d.delta; msgDiv.textContent = assistantText; }\
              } catch(e) {}\
            } else if (line.startsWith("data: ") && evtType === "specialist_start") {\
              try {\
                var d = JSON.parse(line.slice(6));\
                var card = document.createElement("div");\
                card.style.cssText = "align-self:flex-start;background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.3);border-radius:8px;padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--teal);";\
                card.textContent = "● " + d.agent + " · " + d.title + " — working...";\
                card.id = "spec-card-" + d.agent;\
                document.getElementById("max-messages").appendChild(card);\
                document.getElementById("max-status").textContent = d.agent + " is working...";\
              } catch(e) {}\
            } else if (line.startsWith("data: ") && evtType === "specialist_done") {\
              try {\
                var d = JSON.parse(line.slice(6));\
                var card = document.getElementById("spec-card-" + d.agent);\
                if (card) { card.textContent = "✅ " + d.agent + " · Done"; card.style.borderColor = "rgba(74,222,128,0.3)"; card.style.background = "rgba(74,222,128,0.08)"; card.style.color = "var(--green)"; }\
              } catch(e) {}\
            } else if (line.startsWith("data: ") && evtType === "done") {\
              finish();\
            }\
            if (!line.startsWith("event: ") && !line.startsWith("data: ") && !line.startsWith(":")) evtType = "";\
          });\
          document.getElementById("max-messages").scrollTop = document.getElementById("max-messages").scrollHeight;\
          read();\
        });\
      }\
      read();\
    }).catch(function(err) {\
      msgDiv.textContent = "Error: " + err.message;\
      finish();\
    });\
    function finish() {\
      if (assistantText) maxHistory.push({ role: "assistant", content: assistantText });\
      localStorage.setItem("maxHistory", JSON.stringify(maxHistory));\
      maxBusy = false;\
      document.getElementById("max-status").textContent = "Idle";\
      document.getElementById("max-status").style.color = "var(--muted)";\
    }\
  }\
  document.getElementById("max-input").addEventListener("keydown", function(e) {\
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); maxSend(); }\
  });\
  maxRender();' dashboard/index.html

echo "Max Pro tab added successfully!"
