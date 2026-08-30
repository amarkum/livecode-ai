window.closeAllSectionsExcept = function(){};
window.updateDockIndicators = function(){};
window.showToast = function(msg){ console.log(msg); };

window.renderMarkdownLikeMdpdfPreview = function(el, markdown, mermaidPrefix) {
  if (!el || markdown == null) return Promise.resolve();
  var md = String(markdown);
  el.classList.add("mdpdf-preview-body", "livecode-markdown-content");
  if (!md.trim()) {
    el.innerHTML = '<p style="opacity:0.4;font-style:italic;">No content.</p>';
    return Promise.resolve();
  }
  try {
    if (typeof window._linkifyBareUrlsInMarkdownGlobal === "function") {
      md = window._linkifyBareUrlsInMarkdownGlobal(md);
    }
    if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
      el.innerHTML = DOMPurify.sanitize(marked.parse(md));
    } else {
      el.textContent = md;
    }
    if (typeof window._decorateCodeBlocksGlobal === "function") {
      window._decorateCodeBlocksGlobal(el, { livecode: true });
    }
    if (typeof window._decorateChatLinksGlobal === "function") {
      window._decorateChatLinksGlobal(el);
    }
  } catch (e) {
    el.innerHTML = '<p style="color:#ef4444;">Error rendering markdown: ' + String((e && e.message) || e) + "</p>";
  }
  return Promise.resolve();
};

window.APP_THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "white", label: "Light" },
  { value: "pink", label: "Pink" },
  { value: "black", label: "Black" }
];

window._getAppTheme = function() {
  var theme = "dark";
  try { theme = localStorage.getItem("livecode-theme") || "dark"; } catch (e) {}
  if (!window.APP_THEME_OPTIONS.some(function(opt) { return opt.value === theme; })) theme = "dark";
  return theme;
};

window.applyAppTheme = function(theme) {
  if (!window.APP_THEME_OPTIONS.some(function(opt) { return opt.value === theme; })) theme = "dark";
  [document.documentElement, document.body].forEach(function(el) {
    el.classList.remove("dark-theme", "white-theme", "pink-theme", "black-theme");
    el.classList.add(theme + "-theme");
  });
  var darkIcon = document.getElementById("app-theme-icon-dark");
  var lightIcon = document.getElementById("app-theme-icon-light");
  var pinkIcon = document.getElementById("app-theme-icon-pink");
  var blackIcon = document.getElementById("app-theme-icon-black");
  if (darkIcon) darkIcon.style.display = theme === "dark" ? "" : "none";
  if (lightIcon) lightIcon.style.display = theme === "white" ? "" : "none";
  if (pinkIcon) pinkIcon.style.display = theme === "pink" ? "" : "none";
  if (blackIcon) blackIcon.style.display = theme === "black" ? "" : "none";
  var hljsDark = document.getElementById("hljs-dark-css");
  var hljsLight = document.getElementById("hljs-light-css");
  var useLightHljs = theme === "white" || theme === "pink";
  if (hljsDark) hljsDark.disabled = useLightHljs;
  if (hljsLight) hljsLight.disabled = !useLightHljs;
  var trigger = document.getElementById("app-theme-toggle");
  if (trigger) {
    var active = window.APP_THEME_OPTIONS.find(function(opt) { return opt.value === theme; });
    var name = active ? active.label : "Dark";
    trigger.title = "Theme: " + name;
    trigger.setAttribute("aria-label", "Theme: " + name);
  }
  try { localStorage.setItem("livecode-theme", theme); } catch (e) {}
  if (window.monaco && typeof window.applyIDEDynamicTheme === "function") {
    window.applyIDEDynamicTheme(theme);
  }
};

window.toggleAppTheme = function() {
  var current = window._getAppTheme();
  var idx = -1;
  window.APP_THEME_OPTIONS.forEach(function(opt, i) {
    if (opt.value === current) idx = i;
  });
  var next = window.APP_THEME_OPTIONS[(idx + 1) % window.APP_THEME_OPTIONS.length];
  window.applyAppTheme(next.value);
};

(function() {
  window.applyAppTheme(window._getAppTheme());
})();

window.isLocalOllamaModel = function(model) {
  const value = String(model || "").trim().toLowerCase();
  return value ? value.includes(":") : false;
};

window.getLivecodeAiModel = function() {
  const defaultModel = "auto";
  try {
    const saved = localStorage.getItem("livecode-ai-model");
    if (saved && String(saved).trim() && !window.isLocalOllamaModel(saved)) {
      return String(saved).trim();
    }
  } catch (e) {}
  return defaultModel;
};

window._livecodeModelOptionsCache = null;

window._applyModelOptionsFromSettings = function(s) {
  if (Array.isArray(s && s.model_options) && s.model_options.length) {
    window._livecodeModelOptionsCache = s.model_options.slice();
    return;
  }
  window._livecodeModelOptionsCache = [{ value: "auto", label: "Auto" }];
};

window.getChatbotModelOptions = function() {
  if (Array.isArray(window._livecodeModelOptionsCache) && window._livecodeModelOptionsCache.length) {
    return window._livecodeModelOptionsCache.slice();
  }
  return [{ value: "auto", label: "Auto" }];
};

window.refreshChatbotModelOptions = function() {
  return fetch("/settings", { cache: "no-store" }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function(s) {
    window._applyModelOptionsFromSettings(s);
    const options = window.getChatbotModelOptions();
    const current = window.getLivecodeAiModel();
    const resolved = options.some(function(opt) { return opt.value === current; }) ? current : "auto";
    if (resolved !== current) {
      window.setChatbotModelValue(resolved);
    } else {
      window.syncChatbotModelLabels();
      window.renderChatbotModelDropdownList(resolved);
    }
    return s;
  });
};

window.updateChatbotModelLabel = function(input) {
  const wrap = input.closest(".chatbot-composer-model-wrap");
  const labelEl = wrap ? wrap.querySelector("[data-chatbot-model-label]") : null;
  if (!labelEl) return;
  const options = window.getChatbotModelOptions();
  const match = options.find(function(opt) { return opt.value === input.value; });
  const label = match ? match.label : "Auto";
  labelEl.textContent = label;
  labelEl.title = label;
  wrap.title = label;
  wrap.setAttribute("aria-label", "Select model: " + label);
};

window.syncChatbotModelLabels = function() {
  document.querySelectorAll("[data-chatbot-model-select]").forEach(function(sel) {
    window.updateChatbotModelLabel(sel);
  });
};

window.renderChatbotModelDropdownList = function(selectedValue) {
  const list = document.getElementById("chatbot-model-dropdown-list");
  if (!list) return;
  const options = window.getChatbotModelOptions();
  const currentValue = selectedValue || window.getLivecodeAiModel();
  const checkSvg = '<svg class="chatbot-model-dropdown-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  list.innerHTML = options.map(function(opt) {
    const isSelected = opt.value === currentValue;
    return '<div class="chatbot-model-dropdown-item' + (isSelected ? " is-selected" : "") + '" data-value="' + opt.value + '" role="option" aria-selected="' + (isSelected ? "true" : "false") + '">' + checkSvg + "<span>" + opt.label + "</span></div>";
  }).join("");
  list.querySelectorAll(".chatbot-model-dropdown-item").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.stopPropagation();
      window.setChatbotModelValue(item.getAttribute("data-value"));
      window.closeChatbotModelDropdown();
    });
  });
};

window.setChatbotModelValue = function(value) {
  const options = window.getChatbotModelOptions();
  const resolvedValue = options.some(function(opt) { return opt.value === value; }) ? value : "auto";
  try { localStorage.setItem("livecode-ai-model", resolvedValue); } catch (e) {}
  document.querySelectorAll("[data-chatbot-model-select]").forEach(function(input) {
    input.value = resolvedValue;
  });
  window.syncChatbotModelLabels();
  window.renderChatbotModelDropdownList(resolvedValue);
};

window.closeChatbotModelDropdown = function() {
  const dropdown = document.getElementById("chatbot-model-dropdown");
  if (dropdown) dropdown.style.display = "none";
  document.querySelectorAll("[data-chatbot-model-trigger]").forEach(function(trigger) {
    trigger.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  });
};

window.toggleChatbotModelDropdown = function(trigger) {
  const dropdown = document.getElementById("chatbot-model-dropdown");
  if (!dropdown || !trigger) return;
  const wasOpen = dropdown.style.display === "flex";
  const activeTrigger = document.querySelector("[data-chatbot-model-trigger].is-open");
  window.closeChatbotModelDropdown();
  if (wasOpen && activeTrigger === trigger) return;
  if (typeof window.closeLivecodeModeDropdown === "function") {
    window.closeLivecodeModeDropdown();
  }
  const rect = trigger.getBoundingClientRect();
  const currentValue = trigger.querySelector("[data-chatbot-model-select]");
  const selectedValue = currentValue ? currentValue.value : "";
  const showDropdown = function() {
    window.renderChatbotModelDropdownList(selectedValue);
    if (dropdown.parentNode !== document.body) {
      document.body.appendChild(dropdown);
    }
    dropdown.style.display = "flex";
    dropdown.style.left = rect.left + "px";
    dropdown.style.minWidth = Math.max(rect.width, 180) + "px";
    dropdown.style.bottom = (window.innerHeight - rect.top + 6) + "px";
    dropdown.style.top = "auto";
    dropdown.style.zIndex = "100200";
    trigger.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
  };
  if (typeof window.refreshChatbotModelOptions === "function") {
    window.refreshChatbotModelOptions().then(showDropdown).catch(showDropdown);
  } else {
    showDropdown();
  }
};

window._bindChatbotModelSelectorTriggers = function() {
  document.querySelectorAll("[data-chatbot-model-trigger]").forEach(function(trigger) {
    if (trigger.dataset.listenerAdded) return;
    trigger.addEventListener("click", function(e) {
      e.stopPropagation();
      e.preventDefault();
      window.toggleChatbotModelDropdown(trigger);
    });
    trigger.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.toggleChatbotModelDropdown(trigger);
      } else if (e.key === "Escape") {
        window.closeChatbotModelDropdown();
      }
    });
    trigger.dataset.listenerAdded = "true";
  });
  if (!window._chatbotModelDocClickInitialized) {
    window._chatbotModelDocClickInitialized = true;
    document.addEventListener("click", function(e) {
      const dropdown = document.getElementById("chatbot-model-dropdown");
      if (!dropdown || dropdown.style.display !== "flex") return;
      const clickedTrigger = e.target.closest("[data-chatbot-model-trigger]");
      if (!dropdown.contains(e.target) && !clickedTrigger) {
        window.closeChatbotModelDropdown();
      }
    });
  }
};

window.initChatbotModelSelectors = function() {
  try {
    window._bindChatbotModelSelectorTriggers();
    const finish = function() {
      const currentModel = window.getLivecodeAiModel();
      const options = window.getChatbotModelOptions();
      const resolvedModel = options.some(function(opt) { return opt.value === currentModel; }) ? currentModel : "auto";
      document.querySelectorAll("[data-chatbot-model-select]").forEach(function(input) {
        input.value = resolvedModel;
        window.updateChatbotModelLabel(input);
      });
      window.renderChatbotModelDropdownList(resolvedModel);
    };
    if (typeof window.refreshChatbotModelOptions === "function") {
      window.refreshChatbotModelOptions().then(finish).catch(finish);
    } else {
      finish();
    }
  } catch (e) {
    console.error("Error initializing chatbot model selectors:", e);
  }
};

window.DEFAULT_FILE_ICON = "/asset/file-icons/default_file.svg";

window.bindFileIconFallback = function(img) {
  if (!img) return;
  img.onerror = function() {
    this.src = window.DEFAULT_FILE_ICON;
    this.onerror = null;
  };
};

window.getFileIcon = function(fileName) {
  var iconBase = "/asset/file-icons/";
  var defaultIcon = window.DEFAULT_FILE_ICON;
  if (!fileName) return defaultIcon;
  var base = String(fileName).split(/[/\\]/).pop() || "";
  var lower = base.toLowerCase();
  var ext = lower.indexOf(".") >= 0 ? lower.split(".").pop() : lower;
  var nameMap = {
    dockerfile: "file_type_docker.svg",
    makefile: "file_type_makefile.svg",
    gmakefile: "file_type_makefile.svg",
    "cmakelists.txt": "file_type_cmake.svg",
    gemfile: "file_type_ruby.svg",
    rakefile: "file_type_ruby.svg",
    vagrantfile: "file_type_vagrant.svg",
    procfile: "file_type_procfile.svg",
    readme: "file_type_markdown.svg",
    license: "file_type_license.svg",
    ".gitignore": "file_type_git.svg",
    ".env": "file_type_dotenv.svg",
    ".env.example": "file_type_dotenv.svg",
  };
  if (nameMap[lower]) return iconBase + nameMap[lower];
  var iconMap = {
    py: "file_type_python.svg", pyc: "file_type_python.svg", pyo: "file_type_python.svg",
    rb: "file_type_ruby.svg", java: "file_type_java.svg", class: "file_type_java.svg",
    js: "file_type_js.svg", jsx: "file_type_reactjs.svg", ts: "file_type_typescript.svg", tsx: "file_type_reactts.svg",
    css: "file_type_css.svg", scss: "file_type_scss.svg", sass: "file_type_sass.svg", less: "file_type_less.svg",
    html: "file_type_html.svg", htm: "file_type_html.svg", json: "file_type_json.svg",
    xml: "file_type_xml.svg", yml: "file_type_yaml.svg", yaml: "file_type_yaml.svg", md: "file_type_markdown.svg",
    markdown: "file_type_markdown.svg", sql: "file_type_sql.svg", sh: "file_type_shell.svg", bash: "file_type_shell.svg",
    zsh: "file_type_shell.svg", go: "file_type_go.svg", rs: "file_type_rust.svg", cpp: "file_type_cpp.svg",
    cc: "file_type_cpp.svg", cxx: "file_type_cpp.svg", c: "file_type_c.svg", h: "file_type_c.svg", cs: "file_type_csharp.svg",
    php: "file_type_php.svg", scala: "file_type_scala.svg", kt: "file_type_kotlin.svg", kts: "file_type_kotlin.svg",
    txt: "file_type_text.svg", text: "file_type_text.svg", log: "file_type_log.svg", ini: "file_type_ini.svg",
    conf: "file_type_config.svg", config: "file_type_config.svg", properties: "file_type_properties.svg",
    prop: "file_type_properties.svg", csv: "file_type_csv.svg", xlsx: "file_type_excel.svg", xls: "file_type_excel.svg",
    db: "file_type_sqlite.svg", sqlite: "file_type_sqlite.svg", sqlite3: "file_type_sqlite.svg",
    vue: "file_type_vue.svg", dockerfile: "file_type_docker.svg", tf: "file_type_terraform.svg",
    gitignore: "file_type_git.svg", env: "file_type_dotenv.svg", toml: "file_type_toml.svg", pdf: "file_type_pdf.svg",
    docx: "file_type_word.svg", doc: "file_type_word.svg", jpg: "file_type_image.svg", jpeg: "file_type_image.svg",
    png: "file_type_image.svg", gif: "file_type_image.svg", svg: "file_type_image.svg", webp: "file_type_image.svg",
    ico: "file_type_image.svg", mp4: "file_type_video.svg", mov: "file_type_video.svg", mp3: "file_type_audio.svg",
    wav: "file_type_audio.svg", zip: "file_type_zip.svg", gz: "file_type_zip.svg", tar: "file_type_zip.svg",
    lic: "file_type_license.svg", swift: "file_type_swift.svg", dart: "file_type_dart.svg", r: "file_type_r.svg",
    lua: "file_type_lua.svg", pl: "file_type_perl.svg", pm: "file_type_perl.svg", ex: "file_type_elixir.svg",
    exs: "file_type_elixir.svg", erl: "file_type_erlang.svg", hs: "file_type_haskell.svg", clj: "file_type_clojure.svg",
    groovy: "file_type_groovy.svg", gradle: "file_type_gradle.svg", pom: "file_type_maven.svg", lock: "file_type_npm.svg",
  };
  if (iconMap[ext]) return iconBase + iconMap[ext];
  return defaultIcon;
};

window.syncAuxiliaryModelSelectors = function(){};
window.updateChatAttachButtonState = function(){};
window.modelSupportsMultimodal = function(){ return true; };

window._livecodeTrimCodeEl = function(codeEl) {
  if (!codeEl) return;
  var node = codeEl.lastChild;
  while (node) {
    if (node.nodeType === 3) {
      var trimmed = node.textContent.replace(/\s+$/g, "");
      if (!trimmed) {
        var prev = node.previousSibling;
        codeEl.removeChild(node);
        node = prev;
        continue;
      }
      node.textContent = trimmed;
      break;
    }
    if (node.nodeType === 1 && node.nodeName === "BR") {
      var prevBr = node.previousSibling;
      codeEl.removeChild(node);
      node = prevBr;
      continue;
    }
    break;
  }
};

window._decorateCodeBlocksGlobal = function(container, options) {
  try {
    if (!container) return;
    const opts = options || {};
    const inLivecode = opts.livecode === true || !!(container.closest && container.closest("#livecode-chat-messages"));
    const prefix = inLivecode ? "livecode" : null;
    Array.from(container.querySelectorAll("pre")).forEach(function(pre) {
      if (!pre || pre.closest(".code-card")) return;
      if (pre.querySelector("code")) return;
      const code = document.createElement("code");
      code.textContent = pre.textContent || "";
      pre.textContent = "";
      pre.appendChild(code);
    });
    const blocks = Array.from(container.querySelectorAll("pre code"));
    blocks.forEach(function(codeEl) {
      if (!codeEl) return;
      if (codeEl.closest(".code-card")) return;
      const pre = codeEl.closest("pre");
      if (!pre || !pre.parentNode) return;
      codeEl.textContent = (codeEl.textContent || "").replace(/\s+$/g, "");
      let lang = "text";
      const m = (codeEl.className || "").match(/language-([\w+-]+)/i);
      if (m && m[1]) {
        lang = m[1].toLowerCase();
      } else {
        const code = codeEl.textContent || "";
        if (code.trim().startsWith("{") || code.trim().startsWith("[")) lang = "json";
        else if (/^\s*(\$\s*)?curl\b/m.test(code) || /\b(apt-get|brew |npm |yarn |pnpm |docker |kubectl )\b/.test(code)) lang = "bash";
        else if (code.includes("def ") || code.includes("import ") || code.includes("print(")) lang = "python";
        else if (code.includes("function ") || code.includes("const ") || code.includes("console.log")) lang = "javascript";
      }
      if (lang === "sh" || lang === "shell" || lang === "zsh") lang = "bash";
      if (typeof hljs !== "undefined") {
        try {
          if (hljs.getLanguage(lang)) codeEl.className = "language-" + lang;
          hljs.highlightElement(codeEl);
        } catch (e) {}
      }
      if (typeof window._livecodeTrimCodeEl === "function") {
        window._livecodeTrimCodeEl(codeEl);
      }
      const card = document.createElement("div");
      card.className = prefix ? ("code-card " + prefix + "-code-card") : "code-card";
      if (prefix) pre.classList.add(prefix + "-code-block");
      const header = document.createElement("div");
      header.className = "code-card-header";
      const langSpan = document.createElement("span");
      langSpan.className = "lang";
      langSpan.textContent = lang;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-code-btn";
      btn.title = "Copy code";
      btn.setAttribute("aria-label", "Copy code");
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      btn.addEventListener("click", function() {
        try {
          const text = codeEl.innerText || codeEl.textContent || "";
          navigator.clipboard.writeText(text).then(function() {
            const old = btn.innerHTML;
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(function() { btn.innerHTML = old; }, 1200);
          });
        } catch (e) {}
      });
      header.appendChild(langSpan);
      header.appendChild(btn);
      pre.parentNode.insertBefore(card, pre);
      card.appendChild(header);
      card.appendChild(pre);
    });
  } catch (e) {}
};

window._linkifyBareUrlsInMarkdownGlobal = function(md) {
  if (!md) return "";
  var parts = String(md).split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]]*\]\([^)]+\))/g);
  var urlRe = /(^|[\s(])((?:https?:\/\/)[^\s<>\])"'`]+)/g;
  return parts.map(function(part) {
    if (!part) return part;
    if (/^```/.test(part) || /^`/.test(part) || /^\[[^\]]*\]\(/.test(part)) return part;
    return part.replace(urlRe, function(_m, prefix, url) {
      var clean = url, trailing = "";
      while (clean.length && /[.,;:!?]+$/.test(clean)) { trailing = clean.slice(-1) + trailing; clean = clean.slice(0, -1); }
      if (!clean) return prefix + url;
      return prefix + "[" + clean + "](" + clean + ")" + trailing;
    });
  }).join("");
};

window._decorateChatLinksGlobal = function(el) {
  if (!el || !el.querySelectorAll) return;
  el.querySelectorAll("a[href]").forEach(function(a) {
    var href = a.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.classList.add("chat-external-link");
  });
};

window._setAppSettingsEyeIcon = function(icon, visible) {
  if (!icon) return;
  if (visible) icon.removeAttribute("hidden");
  else icon.setAttribute("hidden", "");
};

window._resetAppSettingsKeyVisibility = function() {
  document.querySelectorAll(".app-settings-key-toggle").forEach(function(btn) {
    var inputId = btn.getAttribute("data-target");
    var input = inputId ? document.getElementById(inputId) : null;
    if (input) input.type = "password";
    window._setAppSettingsEyeIcon(btn.querySelector(".app-settings-eye-open"), true);
    window._setAppSettingsEyeIcon(btn.querySelector(".app-settings-eye-closed"), false);
    btn.setAttribute("aria-label", "Show API key");
    btn.title = "Show API key";
  });
};

window.toggleAppSettingsKeyVisibility = function(btn) {
  if (!btn) return;
  var inputId = btn.getAttribute("data-target");
  var input = inputId ? document.getElementById(inputId) : null;
  if (!input) return;
  var show = input.type === "password";
  input.type = show ? "text" : "password";
  window._setAppSettingsEyeIcon(btn.querySelector(".app-settings-eye-open"), !show);
  window._setAppSettingsEyeIcon(btn.querySelector(".app-settings-eye-closed"), show);
  btn.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
  btn.title = show ? "Hide API key" : "Show API key";
};

window._applyAppSettingsToForm = function(s) {
  if (!s) return;
  window._resetAppSettingsKeyVisibility();
  function applyKey(provider, keyValue, keyError) {
    var input = document.getElementById("app-settings-" + provider + "-key");
    var status = document.getElementById("app-settings-" + provider + "-key-status");
    if (input) input.value = keyValue || "";
    if (status) {
      status.textContent = keyError ? ("Invalid key: " + keyError) : "";
      status.style.display = keyError ? "" : "none";
    }
  }

  applyKey("openai", s.openai_api_key || "", s.openai_api_key_error || "");
  applyKey("gemini", s.gemini_api_key || "", s.gemini_api_key_error || "");
};

window.openAppSettings = function() {
  fetch("/settings?validate=1", { cache: "no-store" }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function(s) {
    window._applyAppSettingsToForm(s);
    if (typeof window._applyModelOptionsFromSettings === "function") {
      window._applyModelOptionsFromSettings(s);
    }
    if (typeof window.syncChatbotModelLabels === "function") {
      window.syncChatbotModelLabels();
    }
    document.getElementById("app-settings-backdrop").classList.add("is-open");
  }).catch(function(err) {
    alert("Could not load settings: " + (err && err.message ? err.message : err));
  });
};

window.closeAppSettings = function() {
  document.getElementById("app-settings-backdrop").classList.remove("is-open");
};

window.saveAppSettings = function() {
  var saveBtn = document.querySelector(".app-settings-save");
  var body = {
    openai_api_key: document.getElementById("app-settings-openai-key").value,
    gemini_api_key: document.getElementById("app-settings-gemini-key").value,
  };
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }
  fetch("/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(function(r) {
    return r.json().then(function(data) {
      if (!r.ok) throw new Error((data && data.error) || ("HTTP " + r.status));
      return data;
    });
  }).then(function(s) {
    window._applyAppSettingsToForm(s);
    if (typeof window._applyModelOptionsFromSettings === "function") {
      window._applyModelOptionsFromSettings(s);
    }
    if (typeof window.refreshChatbotModelOptions === "function") {
      window.refreshChatbotModelOptions().catch(function() {});
    } else if (typeof window.syncChatbotModelLabels === "function") {
      window.syncChatbotModelLabels();
    }
    window.closeAppSettings();
    if (typeof window.showToast === "function") window.showToast("Settings saved");
    else alert("Settings saved");
  }).catch(function(err) {
    alert("Failed to save settings: " + (err && err.message ? err.message : err));
  }).finally(function() {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
};
/* Prima Sans Mono for Monaco/code (PrimaSansMono-Regular.otf); Prima Sans for UI */
window.LIVECODE_MONACO_FONT =
  "'Prima Sans Mono', 'Prima Sans Mono W01 Roman', 'PrimaSansMonoW01-Roman', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

window.installLivecodeMonacoDefaults = function installLivecodeMonacoDefaults() {
  if (!window.monaco || !window.monaco.editor) {
    return false;
  }
  if (window._livecodeMonacoDefaultsInstalled) {
    return true;
  }
  window._livecodeMonacoDefaultsInstalled = true;
  var origCreate = window.monaco.editor.create.bind(window.monaco.editor);
  window.monaco.editor.create = function (domElement, options, override) {
    var merged = Object.assign(
      {
        maxTokenizationLineLength: 50000,
        fontFamily: window.LIVECODE_MONACO_FONT,
        fontLigatures: false,
        fontWeight: "400",
      },
      options || {}
    );
    merged.fontFamily = window.LIVECODE_MONACO_FONT;
    merged.fontLigatures = false;
    merged.fontWeight = "400";
    var editor = origCreate(domElement, merged, override);
    var applyFont = function () {
      try {
        editor.updateOptions({
          fontFamily: window.LIVECODE_MONACO_FONT,
          fontLigatures: false,
          fontWeight: "400",
        });
        window.monaco.editor.remeasureFonts();
        editor.layout();
      } catch (e) {}
    };
    applyFont();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        var loads = [];
        if (document.fonts.load) {
          loads.push(document.fonts.load("400 13px 'Prima Sans Mono'"));
          loads.push(document.fonts.load("400 13px 'Prima Sans Mono W01 Roman'"));
        }
        return Promise.all(loads).then(applyFont, applyFont);
      });
    }
    return editor;
  };
  return true;
};

(function watchForMonaco() {
  var attempts = 0;
  var timer = setInterval(function () {
    if (window.installLivecodeMonacoDefaults() || ++attempts > 600) {
      clearInterval(timer);
    }
  }, 100);
})();
window.buildChatAttachmentPrompt = function(attachments) {
  attachments = attachments || [];
  var fileNames = attachments.map(function(a) { return a.name; }).join(", ");
  return "Analyze the attached file" + (attachments.length > 1 ? "s" : "") + ": " + fileNames;
};

window.livecodePendingAttachments = [];

window.livecodeAttachmentsLoadingCount = 0;

window._livecodeInsertRange = null;

const LIVECODE_MAX_ATTACHMENTS = 10;
const LIVECODE_ATTACHMENT_MAX_TEXT = 40000;

window.livecodeQueueAttachmentFiles = function(files, options) {
  options = options || {};
  var maxAttachments = options.maxAttachments || LIVECODE_MAX_ATTACHMENTS;
  var getList = options.getList || function() { return []; };
  var onAttachment = options.onAttachment || function() {};
  var onUpdate = options.onUpdate || function() {};
  var loadingKey = options.loadingKey || "livecodeAttachmentsLoadingCount";
  var textExtRe = /\.(txt|md|markdown|csv|tsv|json|log|py|js|jsx|ts|tsx|java|go|rb|php|c|cpp|h|hpp|cs|html|htm|css|scss|xml|yaml|yml|sql|sh|ini|conf|toml|env)$/i;

  function setLoadingCount(next) {
    window[loadingKey] = Math.max(0, next);
    onUpdate();
  }

  Array.from(files || []).forEach(function(file) {
    if (!file) return;
    var list = getList();
    if (list.length >= maxAttachments) {
      alert("Maximum " + maxAttachments + " attachments per message.");
      return;
    }

    setLoadingCount((window[loadingKey] || 0) + 1);
    var attachment = {
      id: window._livecodeMakeAttachmentId(),
      name: file.name || "file",
      size: file.size || 0,
      type: "binary",
    };

    function finish(att) {
      onAttachment(att);
      setLoadingCount((window[loadingKey] || 0) - 1);
    }

    function fail(message) {
      alert(message || ("Could not read file: " + file.name));
      setLoadingCount((window[loadingKey] || 0) - 1);
    }

    if (file.type && file.type.indexOf("image/") === 0) {
      var imageReader = new FileReader();
      imageReader.onload = function() {
        attachment.type = "image";
        attachment.data = imageReader.result;
        finish(attachment);
      };
      imageReader.onerror = function() { fail("Could not read image: " + file.name); };
      imageReader.readAsDataURL(file);
      return;
    }

    if (textExtRe.test(file.name) || (file.type && file.type.indexOf("text/") === 0) || file.type === "application/json") {
      var textReader = new FileReader();
      textReader.onload = function() {
        var content = String(textReader.result || "");
        attachment.type = "file";
        attachment.content = content.length > LIVECODE_ATTACHMENT_MAX_TEXT
          ? content.slice(0, LIVECODE_ATTACHMENT_MAX_TEXT)
          : content;
        if (content.length > LIVECODE_ATTACHMENT_MAX_TEXT) attachment.truncated = true;
        finish(attachment);
      };
      textReader.onerror = function() {
        attachment.type = "binary";
        attachment.note = "Could not read file contents";
        finish(attachment);
      };
      textReader.readAsText(file);
      return;
    }

    attachment.note = "Binary file attached by name only";
    finish(attachment);
  });
};

window._livecodeMakeAttachmentId = function() {
  return "livecode-att-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
};

window._livecodeGetComposerInput = function() {
  return document.getElementById("livecode-chat-input");
};

window._livecodeUpdateComposerPlaceholder = function() {
  var input = window._livecodeGetComposerInput();
  if (!input) return;
  var empty = typeof window._livecodeComposerIsVisuallyEmpty === "function"
    ? window._livecodeComposerIsVisuallyEmpty(input)
    : (!(input.textContent || "").trim() && !input.querySelector(".livecode-inline-file-chip"));
  input.classList.toggle("is-empty", empty);
};

window._livecodeResizeComposerInput = function() {
  var input = window._livecodeGetComposerInput();
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
};

window._livecodeGetComposerSelectionRange = function() {
  var input = window._livecodeGetComposerInput();
  if (!input) return null;
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  var range = sel.getRangeAt(0);
  if (!input.contains(range.startContainer)) return null;
  return range.cloneRange();
};

window._livecodeSaveDropCaret = function(e) {
  var input = window._livecodeGetComposerInput();
  if (!input || !e) return;
  var range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } else if (e.clientX != null && document.caretPositionFromPoint) {
    var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (range && input.contains(range.startContainer)) {
    window._livecodeInsertRange = range.cloneRange();
  }
};

window._livecodeSetComposerSelection = function(range) {
  if (!range) return;
  var sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
};

/** True when composer has no chips and no meaningful text (ignores <br>/nbsp). */
window._livecodeComposerIsVisuallyEmpty = function(input) {
  if (!input) return true;
  if (input.querySelector(".livecode-inline-file-chip")) return false;
  var text = (input.textContent || "").replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();
  return !text;
};

/** Place caret in the composer after a chip removal. Always builds a fresh range. */
window._livecodePlaceComposerCaretAt = function(input, childIndex) {
  if (!input) return null;
  var range = document.createRange();
  var kids = input.childNodes;
  // Empty (or only <br>/nbsp) → clear and put caret at start
  if (window._livecodeComposerIsVisuallyEmpty(input)) {
    if (input.innerHTML !== "") input.innerHTML = "";
    range.setStart(input, 0);
    range.collapse(true);
  } else {
    var idx = typeof childIndex === "number" ? childIndex : 0;
    if (idx < 0) idx = 0;
    if (idx > kids.length) idx = kids.length;
    if (idx < kids.length) {
      range.setStart(input, idx);
      range.collapse(true);
    } else {
      range.selectNodeContents(input);
      range.collapse(false);
    }
  }
  window._livecodeSetComposerSelection(range);
  return range;
};

window._livecodeInsertNodeAtComposerCaret = function(node, atRange) {
  var input = window._livecodeGetComposerInput();
  if (!input || !node) return;
  var range = atRange || window._livecodeInsertRange || window._livecodeGetComposerSelectionRange();
  if (!range) {
    input.appendChild(node);
    range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
  } else {
    range.collapse(true);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  }
  var spacer = document.createTextNode("\u00a0");
  range.insertNode(spacer);
  range.setStartAfter(spacer);
  range.collapse(true);
  window._livecodeSetComposerSelection(range);
  window._livecodeInsertRange = null;
  window._livecodeUpdateComposerPlaceholder();
  window._livecodeResizeComposerInput();
};

window.buildLivecodeInlineFileChipElement = function(attachment, options) {
  options = options || {};
  var chip = document.createElement("span");
  chip.className = "livecode-inline-file-chip theme-transition";
  if (attachment.type === "repo_folder") {
    chip.classList.add("livecode-inline-repo-chip", "livecode-inline-repo-folder-chip");
  } else if (attachment.type === "repo_file") {
    chip.classList.add("livecode-inline-repo-chip");
  }
  chip.contentEditable = "false";
  chip.setAttribute("data-attachment-id", attachment.id || "");
  var chipTitle = attachment.name || "";
  if (attachment.repo_path) chipTitle = attachment.repo_path;
  chip.title = chipTitle;

  var fileName = attachment.name || "file";
  if (/\.json$/i.test(fileName)) {
    chip.classList.add("livecode-json-pill");
  }
  var iconSrc;
  if (attachment.type === "repo_folder") {
    iconSrc = "/asset/common/folder.png";
  } else {
    iconSrc = typeof window.getFileIcon === "function"
      ? window.getFileIcon(fileName)
      : "/asset/file-icons/default_file.svg";
  }
  var iconImg = document.createElement("img");
  iconImg.className = "livecode-inline-file-icon";
  iconImg.src = iconSrc;
  iconImg.alt = "";
  iconImg.setAttribute("aria-hidden", "true");
  window.bindFileIconFallback(iconImg);
  chip.appendChild(iconImg);

  var nameSpan = document.createElement("span");
  nameSpan.className = "livecode-inline-file-name";
  nameSpan.textContent = typeof window.shortenStartExtFilename === "function"
    ? window.shortenStartExtFilename(attachment.name || "file", 28)
    : (attachment.name || "file");
  chip.appendChild(nameSpan);

  if (!options.readonly) {
    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "livecode-inline-file-remove";
    removeBtn.title = "Remove file";
    removeBtn.setAttribute("aria-label", "Remove file");
    removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    removeBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.removeLivecodeAttachmentById(attachment.id);
      return false;
    };
    chip.appendChild(removeBtn);
  }

  return chip;
};

window.insertLivecodeInlineFileChip = function(attachment, atRange) {
  if (!attachment || !attachment.id) return;
  var chip = window.buildLivecodeInlineFileChipElement(attachment, {});
  window._livecodeInsertNodeAtComposerCaret(chip, atRange);
};

window.addLivecodeRepoContextToChat = function(opts) {
  opts = opts || {};
  var projectPath = typeof window.getLiveCodeProjectPath === "function"
    ? window.getLiveCodeProjectPath()
    : null;
  if (!projectPath) {
    alert("Open a project folder first.");
    return false;
  }
  var repoPath = String(opts.repoPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  var kind = opts.kind === "folder" ? "folder" : "file";
  var attType = kind === "folder" ? "repo_folder" : "repo_file";
  var name = opts.name || (repoPath ? repoPath.split("/").pop() : "") || (kind === "folder" ? "folder" : "file");
  var pending = window.livecodePendingAttachments || [];
  if (pending.length >= LIVECODE_MAX_ATTACHMENTS) {
    alert("Maximum " + LIVECODE_MAX_ATTACHMENTS + " attachments per message.");
    return false;
  }
  var isDupe = pending.some(function(a) {
    return a && a.type === attType && String(a.repo_path || "") === repoPath;
  });
  if (isDupe) return false;
  var attachment = {
    id: window._livecodeMakeAttachmentId(),
    name: name,
    type: attType,
    repo_path: repoPath,
    size: 0
  };
  pending.push(attachment);
  window.livecodePendingAttachments = pending;
  window.insertLivecodeInlineFileChip(attachment);
  window._livecodeUpdateComposerPlaceholder();
  window._livecodeResizeComposerInput();
  if (typeof window.updateLivecodeComposerSendState === "function") {
    window.updateLivecodeComposerSendState();
  }
  var input = window._livecodeGetComposerInput();
  if (input && typeof input.focus === "function") input.focus();
  return true;
};

window._livecodeMentionState = {
  active: false,
  query: "",
  results: [],
  selectedIndex: 0,
  debounceTimer: null,
  browseDir: "",
  searching: false
};

window.addLivecodeImageThumbnail = function(attachment) {
  if (!attachment || !attachment.id || attachment.type !== "image") return;
  var strip = document.getElementById("livecode-image-thumbnails");
  if (!strip) return;
  if (strip.querySelector('[data-attachment-id="' + attachment.id + '"]')) return;

  var wrap = document.createElement("div");
  wrap.className = "livecode-image-thumb-wrap theme-transition";
  wrap.setAttribute("data-attachment-id", attachment.id);

  var img = document.createElement("img");
  img.className = "livecode-image-thumb";
  img.src = attachment.data || "";
  img.alt = attachment.name || "image";
  wrap.appendChild(img);

  var removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "livecode-image-thumb-remove";
  removeBtn.title = "Remove image";
  removeBtn.setAttribute("aria-label", "Remove image");
  removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  removeBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.removeLivecodeAttachmentById(attachment.id);
    return false;
  };
  wrap.appendChild(removeBtn);

  strip.appendChild(wrap);
  strip.style.display = "flex";
  strip.removeAttribute("aria-hidden");
};

window._livecodeRouteAttachmentToComposer = function(attachment) {
  if (!attachment) return;
  if (!attachment.id) attachment.id = window._livecodeMakeAttachmentId();
  if (attachment.type === "image" && attachment.data) {
    window.addLivecodeImageThumbnail(attachment);
  } else {
    // Keep advancing caret so multi-file drops insert sequentially
    var atRange = window._livecodeInsertRange
      ? window._livecodeInsertRange.cloneRange()
      : window._livecodeGetComposerSelectionRange();
    window.insertLivecodeInlineFileChip(attachment, atRange);
    window._livecodeInsertRange = window._livecodeGetComposerSelectionRange();
  }
};

window.removeLivecodeAttachmentById = function(id) {
  if (!id) return false;
  var input = window._livecodeGetComposerInput();
  var caretIndex = null;
  if (input) {
    var chip = input.querySelector('.livecode-inline-file-chip[data-attachment-id="' + id + '"]');
    if (chip && chip.parentNode === input) {
      caretIndex = Array.prototype.indexOf.call(input.childNodes, chip);
      var next = chip.nextSibling;
      chip.remove();
      // Drop the trailing spacer inserted with the chip
      if (next && next.nodeType === Node.TEXT_NODE && (next.textContent === "\u00a0" || next.textContent === " ")) {
        next.remove();
      }
    } else if (chip) {
      chip.remove();
      caretIndex = 0;
    }
  }
  window.livecodePendingAttachments = (window.livecodePendingAttachments || []).filter(function(a) {
    return a && a.id !== id;
  });
  var strip = document.getElementById("livecode-image-thumbnails");
  if (strip) {
    var thumb = strip.querySelector('[data-attachment-id="' + id + '"]');
    if (thumb) thumb.remove();
    if (!strip.children.length) {
      strip.style.display = "none";
      strip.setAttribute("aria-hidden", "true");
    }
  }
  if (input) {
    window._livecodeUpdateComposerPlaceholder();
    input.focus();
    var placeIdx = caretIndex != null ? caretIndex : 0;
    var caretRange = window._livecodePlaceComposerCaretAt(input, placeIdx);
    window._livecodeInsertRange = caretRange ? caretRange.cloneRange() : null;
    // Remove-button click can leave selection after layout; re-assert at start/index
    requestAnimationFrame(function() {
      var again = window._livecodePlaceComposerCaretAt(input, placeIdx);
      if (again) window._livecodeInsertRange = again.cloneRange();
      window._livecodeUpdateComposerPlaceholder();
    });
  } else {
    window._livecodeUpdateComposerPlaceholder();
  }
  window._livecodeResizeComposerInput();
  if (typeof window.updateLivecodeComposerSendState === "function") {
    window.updateLivecodeComposerSendState();
  }
  return false;
};

/** Drop pending attachments whose chips/thumbs were removed via contentEditable edit. */
window._livecodeSyncAttachmentsFromDom = function() {
  var input = window._livecodeGetComposerInput();
  var strip = document.getElementById("livecode-image-thumbnails");
  var liveIds = {};
  if (input) {
    input.querySelectorAll(".livecode-inline-file-chip[data-attachment-id]").forEach(function(el) {
      var id = el.getAttribute("data-attachment-id");
      if (id) liveIds[id] = true;
    });
  }
  if (strip) {
    strip.querySelectorAll("[data-attachment-id]").forEach(function(el) {
      var id = el.getAttribute("data-attachment-id");
      if (id) liveIds[id] = true;
    });
  }
  var pending = window.livecodePendingAttachments || [];
  var next = pending.filter(function(a) {
    return a && a.id && liveIds[a.id];
  });
  if (next.length !== pending.length) {
    window.livecodePendingAttachments = next;
    if (typeof window.updateLivecodeComposerSendState === "function") {
      window.updateLivecodeComposerSendState();
    }
  }
};

window.getLivecodeComposerState = function() {
  var input = window._livecodeGetComposerInput();
  var segments = [];
  var textParts = [];

  function walk(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      var val = node.textContent || "";
      if (!val || val === "\u00a0") return;
      segments.push({ type: "text", value: val });
      textParts.push(val);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList && node.classList.contains("livecode-inline-file-chip")) {
      var attId = node.getAttribute("data-attachment-id") || "";
      segments.push({ type: "file", attachment_id: attId });
      return;
    }
    Array.from(node.childNodes).forEach(walk);
  }

  if (input) Array.from(input.childNodes).forEach(walk);

  var attachments = (window.livecodePendingAttachments || []).map(function(a) {
    var copy = {
      id: a.id,
      name: a.name,
      type: a.type || "file",
      size: a.size || 0
    };
    if (a.type === "image" && a.data) {
      copy.data = a.data;
    } else if (a.type === "repo_file" || a.type === "repo_folder") {
      copy.repo_path = a.repo_path || "";
    } else if (a.type === "binary") {
      copy.content = a.content || "";
      if (a.note) copy.note = a.note;
    } else if (a.content !== undefined) {
      copy.content = a.content;
      if (a.truncated) copy.truncated = true;
      if (a.pageCount !== undefined) copy.pageCount = a.pageCount;
    }
    return copy;
  });

  return {
    text: textParts.join("").trim(),
    segments: segments,
    attachments: attachments
  };
};

window.clearLivecodeComposer = function() {
  var input = window._livecodeGetComposerInput();
  if (input) input.innerHTML = "";
  var strip = document.getElementById("livecode-image-thumbnails");
  if (strip) {
    strip.innerHTML = "";
    strip.style.display = "none";
    strip.setAttribute("aria-hidden", "true");
  }
  window.livecodePendingAttachments = [];
  window._livecodeInsertRange = null;
  if (typeof window._livecodeCloseMentionMenu === "function") {
    window._livecodeCloseMentionMenu();
  }
  window._livecodeUpdateComposerPlaceholder();
  window._livecodeResizeComposerInput();
};

window._livecodeGetActiveMention = function() {
  var input = window._livecodeGetComposerInput();
  if (!input) return null;
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  var range = sel.getRangeAt(0);
  if (!input.contains(range.startContainer)) return null;
  var preRange = range.cloneRange();
  preRange.selectNodeContents(input);
  preRange.setEnd(range.startContainer, range.startOffset);
  var before = preRange.toString();
  var atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  if (atIndex > 0 && !/\s/.test(before.charAt(atIndex - 1))) return null;
  var query = before.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { query: query, atIndex: atIndex, before: before };
};

window._livecodeCaptureMentionDeleteRange = function(mention) {
  if (!mention) return null;
  var input = window._livecodeGetComposerInput();
  var sel = window.getSelection();
  if (!input || !sel || sel.rangeCount === 0) return null;
  var endRange = sel.getRangeAt(0);
  var walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT, null, false);
  var charsLeft = mention.atIndex;
  var startNode = null;
  var startOffset = 0;
  while (walker.nextNode()) {
    var node = walker.currentNode;
    var len = (node.textContent || "").length;
    if (charsLeft <= len) {
      startNode = node;
      startOffset = charsLeft;
      break;
    }
    charsLeft -= len;
  }
  if (!startNode) return null;
  var delRange = document.createRange();
  delRange.setStart(startNode, startOffset);
  delRange.setEnd(endRange.endContainer, endRange.endOffset);
  return delRange;
};

window._livecodeCloseMentionMenu = function() {
  var menu = document.getElementById("livecode-mention-menu");
  if (menu) {
    menu.style.display = "none";
    menu.innerHTML = "";
  }
  window._livecodeMentionState.active = false;
  window._livecodeMentionState.query = "";
  window._livecodeMentionState.results = [];
  window._livecodeMentionState.selectedIndex = 0;
  window._livecodeMentionState.browseDir = "";
  window._livecodeMentionState.searching = false;
  if (window._livecodeMentionState.debounceTimer) {
    clearTimeout(window._livecodeMentionState.debounceTimer);
    window._livecodeMentionState.debounceTimer = null;
  }
};

window._livecodeMentionParentDir = function(dir) {
  var path = String(dir || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) return "";
  var parts = path.split("/");
  parts.pop();
  return parts.join("/");
};

window._livecodeMentionEscapeHtml = function(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
};

window._livecodePositionMentionMenu = function() {
  var menu = document.getElementById("livecode-mention-menu");
  var input = window._livecodeGetComposerInput();
  if (!menu || !input) return;
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  var rect = sel.getRangeAt(0).getBoundingClientRect();
  var top = rect.top - menu.offsetHeight - 6;
  if (top < 8) top = rect.bottom + 6;
  menu.style.left = Math.max(8, rect.left) + "px";
  menu.style.top = Math.max(8, top) + "px";
};

window._livecodeReplaceActiveMentionText = function(nextText) {
  var mention = window._livecodeGetActiveMention();
  var delRange = window._livecodeCaptureMentionDeleteRange(mention);
  if (!delRange) return false;
  delRange.deleteContents();
  var textNode = document.createTextNode(nextText == null ? "@" : String(nextText));
  delRange.insertNode(textNode);
  var caret = document.createRange();
  caret.setStart(textNode, textNode.textContent.length);
  caret.collapse(true);
  window._livecodeSetComposerSelection(caret);
  window._livecodeInsertRange = caret.cloneRange();
  return true;
};

window._livecodeBrowseMentionDir = function(dir) {
  window._livecodeMentionState.browseDir = String(dir || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  window._livecodeMentionState.query = "";
  window._livecodeMentionState.active = true;
  window._livecodeMentionState.searching = false;
  // Keep only "@" in the composer so browse mode is not overridden by leftover query text
  window._livecodeReplaceActiveMentionText("@");
  window._livecodeSearchMentionTargets("", window._livecodeMentionState.browseDir);
};

window._livecodeAttachMentionItem = function(item) {
  if (!item) return;
  var mention = window._livecodeGetActiveMention();
  var delRange = window._livecodeCaptureMentionDeleteRange(mention);
  if (delRange) {
    delRange.deleteContents();
    window._livecodeSetComposerSelection(delRange);
  }
  window._livecodeCloseMentionMenu();
  window.addLivecodeRepoContextToChat({
    repoPath: item.path || "",
    kind: item.kind === "folder" ? "folder" : "file",
    name: item.name || item.path || ""
  });
};

window._livecodeRenderMentionMenu = function() {
  var menu = document.getElementById("livecode-mention-menu");
  if (!menu) return;
  var state = window._livecodeMentionState;
  var results = state.results || [];
  var browseDir = String(state.browseDir || "");
  var isBrowse = !state.searching;
  var headerLabel = state.searching
    ? "Files &amp; Folders"
    : (browseDir ? window._livecodeMentionEscapeHtml(browseDir) : "Files &amp; Folders");

  var html = '<div class="livecode-mention-header theme-transition">' +
    '<span class="livecode-mention-header-title">' + headerLabel + "</span>" +
    '<span class="livecode-mention-header-actions">';
  if (isBrowse && browseDir) {
    html += '<button type="button" class="livecode-mention-attach-folder theme-transition" data-mention-attach-current="1" title="Attach this folder">Attach</button>';
  }
  html += "</span></div>";

  if (isBrowse && browseDir) {
    var parent = window._livecodeMentionParentDir(browseDir);
    html += '<button type="button" class="livecode-mention-crumb theme-transition" data-mention-back="1">' +
      '<span aria-hidden="true">←</span>' +
      '<span class="livecode-mention-crumb-path">' +
      window._livecodeMentionEscapeHtml(parent || "/") +
      "</span></button>";
  }

  if (!results.length) {
    html += '<div class="livecode-mention-empty">No files or folders found</div>';
    menu.innerHTML = html;
    menu.style.display = "block";
    window._livecodeBindMentionMenuEvents(menu);
    window._livecodePositionMentionMenu();
    return;
  }

  results.forEach(function(item, idx) {
    var icon = item.kind === "folder" ? "/asset/common/folder.png" : (
      typeof window.getFileIcon === "function" ? window.getFileIcon(item.name || item.path) : "/asset/file-icons/default_file.svg"
    );
    var path = item.path || "";
    var escPath = window._livecodeMentionEscapeHtml(path);
    var escName = window._livecodeMentionEscapeHtml(item.name || path);
    var hint = item.kind === "folder" ? '<span class="livecode-mention-folder-hint">›</span>' : "";
    html += '<button type="button" class="livecode-mention-item theme-transition' +
      (idx === state.selectedIndex ? " is-selected" : "") +
      '" data-mention-index="' + idx + '">' +
      '<img class="livecode-mention-icon" src="' + icon + '" alt="" onerror="this.onerror=null;this.src=\'' + window.DEFAULT_FILE_ICON + '\'" />' +
      '<span class="livecode-mention-label">' + escName + "</span>" +
      '<span class="livecode-mention-path">' + escPath + "</span>" +
      hint +
      "</button>";
  });
  menu.innerHTML = html;
  menu.style.display = "block";
  window._livecodeBindMentionMenuEvents(menu);
  var selected = menu.querySelector(".livecode-mention-item.is-selected");
  if (selected && typeof selected.scrollIntoView === "function") {
    selected.scrollIntoView({ block: "nearest" });
  }
  window._livecodePositionMentionMenu();
};

window._livecodeBindMentionMenuEvents = function(menu) {
  if (!menu) return;
  var backBtn = menu.querySelector("[data-mention-back]");
  if (backBtn) {
    backBtn.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      var parent = window._livecodeMentionParentDir(window._livecodeMentionState.browseDir);
      window._livecodeBrowseMentionDir(parent);
    });
  }
  var attachCurrent = menu.querySelector("[data-mention-attach-current]");
  if (attachCurrent) {
    attachCurrent.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      var dir = window._livecodeMentionState.browseDir || "";
      if (!dir) return;
      window._livecodeAttachMentionItem({
        kind: "folder",
        path: dir,
        name: dir.split("/").pop() || dir
      });
    });
  }
  menu.querySelectorAll(".livecode-mention-item").forEach(function(btn) {
    btn.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      var index = parseInt(btn.getAttribute("data-mention-index"), 10);
      window._livecodeSelectMentionResult(index);
    });
  });
};

window._livecodeSearchMentionTargets = function(query, directory) {
  var projectPath = typeof window.getLiveCodeProjectPath === "function"
    ? window.getLiveCodeProjectPath()
    : null;
  if (!projectPath) {
    window._livecodeMentionState.results = [];
    window._livecodeRenderMentionMenu();
    return;
  }
  var q = query || "";
  var searching = !!String(q).trim();
  window._livecodeMentionState.searching = searching;
  var url = "/livecode/context-search?project_path=" + encodeURIComponent(projectPath) +
    "&q=" + encodeURIComponent(q) +
    "&limit=40";
  if (!searching) {
    var dir = directory !== undefined ? directory : window._livecodeMentionState.browseDir;
    url += "&directory=" + encodeURIComponent(dir || "");
  }
  fetch(url).then(function(resp) { return resp.json(); }).then(function(data) {
    if (!window._livecodeMentionState.active) return;
    if (window._livecodeMentionState.query !== q && searching) return;
    if (!searching && (directory !== undefined) &&
        String(window._livecodeMentionState.browseDir || "") !== String(directory || "")) {
      return;
    }
    window._livecodeMentionState.results = (data && data.results) || [];
    window._livecodeMentionState.selectedIndex = 0;
    if (!searching && data && data.directory !== undefined) {
      window._livecodeMentionState.browseDir = data.directory || "";
    }
    window._livecodeRenderMentionMenu();
  }).catch(function() {
    if (!window._livecodeMentionState.active) return;
    window._livecodeMentionState.results = [];
    window._livecodeRenderMentionMenu();
  });
};

window._livecodeSelectMentionResult = function(index) {
  var state = window._livecodeMentionState;
  var item = (state.results || [])[index];
  if (!item) return;
  if (item.kind === "folder") {
    window._livecodeBrowseMentionDir(item.path || "");
    return;
  }
  window._livecodeAttachMentionItem(item);
};

window._livecodeHandleMentionInput = function() {
  var mention = window._livecodeGetActiveMention();
  if (!mention) {
    window._livecodeCloseMentionMenu();
    return;
  }
  window._livecodeMentionState.active = true;
  window._livecodeMentionState.query = mention.query;
  if (window._livecodeMentionState.debounceTimer) {
    clearTimeout(window._livecodeMentionState.debounceTimer);
  }
  window._livecodeMentionState.debounceTimer = setTimeout(function() {
    var q = window._livecodeMentionState.query || "";
    if (String(q).trim()) {
      window._livecodeSearchMentionTargets(q);
    } else {
      window._livecodeSearchMentionTargets("", window._livecodeMentionState.browseDir || "");
    }
  }, 120);
};

window.initLivecodeComposerInput = function() {
  var input = window._livecodeGetComposerInput();
  if (!input || input.dataset.livecodeComposerInit) return;
  input.dataset.livecodeComposerInit = "true";

  input.addEventListener("input", function() {
    window._livecodeSyncAttachmentsFromDom();
    window._livecodeUpdateComposerPlaceholder();
    window._livecodeResizeComposerInput();
    window._livecodeHandleMentionInput();
  });

  input.addEventListener("focus", function() {
    window._livecodeUpdateComposerPlaceholder();
  });
  input.addEventListener("blur", function() {
    window._livecodeUpdateComposerPlaceholder();
  });

  input.addEventListener("paste", function(e) {
    var clipboard = e.clipboardData || window.clipboardData;
    if (!clipboard) return;
    var imageFiles = [];
    if (clipboard.items) {
      for (var i = 0; i < clipboard.items.length; i++) {
        var item = clipboard.items[i];
        if (item.kind === "file" && item.type && item.type.indexOf("image/") === 0) {
          var file = item.getAsFile && item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      window.queueLivecodeAttachmentFiles(imageFiles);
      return;
    }
    e.preventDefault();
    var text = clipboard.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
  });

  input.addEventListener("keydown", function(e) {
    if (window._livecodeMentionState.active) {
      var results = window._livecodeMentionState.results || [];
      if (e.key === "ArrowDown" && results.length) {
        e.preventDefault();
        window._livecodeMentionState.selectedIndex =
          (window._livecodeMentionState.selectedIndex + 1) % results.length;
        window._livecodeRenderMentionMenu();
        return;
      }
      if (e.key === "ArrowUp" && results.length) {
        e.preventDefault();
        window._livecodeMentionState.selectedIndex =
          (window._livecodeMentionState.selectedIndex - 1 + results.length) % results.length;
        window._livecodeRenderMentionMenu();
        return;
      }
      if (e.key === "ArrowLeft" && !window._livecodeMentionState.searching) {
        var browseDir = window._livecodeMentionState.browseDir || "";
        if (browseDir) {
          e.preventDefault();
          window._livecodeBrowseMentionDir(window._livecodeMentionParentDir(browseDir));
          return;
        }
      }
      if (e.key === "ArrowRight" && results.length) {
        var rightItem = results[window._livecodeMentionState.selectedIndex];
        if (rightItem && rightItem.kind === "folder") {
          e.preventDefault();
          window._livecodeBrowseMentionDir(rightItem.path || "");
          return;
        }
      }
      if (e.key === "Enter" && results.length) {
        e.preventDefault();
        var focused = results[window._livecodeMentionState.selectedIndex];
        if (e.shiftKey && focused && focused.kind === "folder") {
          window._livecodeAttachMentionItem(focused);
          return;
        }
        window._livecodeSelectMentionResult(window._livecodeMentionState.selectedIndex);
        return;
      }
      if (e.key === "Enter" && !results.length && (window._livecodeMentionState.browseDir || "") && e.shiftKey) {
        e.preventDefault();
        var dir = window._livecodeMentionState.browseDir;
        window._livecodeAttachMentionItem({
          kind: "folder",
          path: dir,
          name: dir.split("/").pop() || dir
        });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        window._livecodeCloseMentionMenu();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (typeof window.sendLiveCodeAgentMessage === "function") {
        window.sendLiveCodeAgentMessage();
      }
      return;
    }
    if (e.key === "Backspace") {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      var offset = range.startOffset;
      var prev = null;
      if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        prev = node.previousSibling;
      } else if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
        prev = node.childNodes[offset - 1];
      } else if (node.nodeType === Node.TEXT_NODE && offset > 0) {
        return;
      }
      if (prev && prev.classList && prev.classList.contains("livecode-inline-file-chip")) {
        e.preventDefault();
        var attId = prev.getAttribute("data-attachment-id");
        window.removeLivecodeAttachmentById(attId);
      }
    }
  });

  window._livecodeUpdateComposerPlaceholder();
  document.addEventListener("mousedown", function(ev) {
    var menu = document.getElementById("livecode-mention-menu");
    if (!menu || menu.style.display === "none") return;
    if (menu.contains(ev.target) || (input && input.contains(ev.target))) return;
    window._livecodeCloseMentionMenu();
  });

  var fileInput = document.getElementById("livecode-attach-file-input");
  if (fileInput && !fileInput.dataset.livecodeAttachInit) {
    fileInput.dataset.livecodeAttachInit = "true";
    fileInput.addEventListener("change", function() {
      if (fileInput.files && fileInput.files.length) {
        window.queueLivecodeAttachmentFiles(Array.from(fileInput.files));
      }
      fileInput.value = "";
    });
  }

  var composer = document.getElementById("livecode-chat-composer");
  if (composer && !composer.dataset.livecodeDropInit) {
    composer.dataset.livecodeDropInit = "true";
    composer.addEventListener("dragover", function(e) {
      e.preventDefault();
      composer.classList.add("is-drag-over");
    });
    composer.addEventListener("dragleave", function() {
      composer.classList.remove("is-drag-over");
    });
    composer.addEventListener("drop", function(e) {
      e.preventDefault();
      composer.classList.remove("is-drag-over");
      window._livecodeSaveDropCaret(e);
      var dropped = [];
      if (e.dataTransfer && e.dataTransfer.files) {
        dropped = Array.from(e.dataTransfer.files);
      }
      if (dropped.length) window.queueLivecodeAttachmentFiles(dropped);
    });
  }
};

window.queueLivecodeAttachmentFiles = function(files) {
  if (!files || !files.length) return;
  // Always refresh caret so delete → re-add inserts at the current position
  var liveRange = window._livecodeGetComposerSelectionRange();
  if (liveRange) {
    window._livecodeInsertRange = liveRange;
  } else if (!window._livecodeInsertRange) {
    var input = window._livecodeGetComposerInput();
    if (input) {
      input.focus();
      var endRange = document.createRange();
      endRange.selectNodeContents(input);
      endRange.collapse(false);
      window._livecodeSetComposerSelection(endRange);
      window._livecodeInsertRange = endRange.cloneRange();
    }
  }
  window.livecodeQueueAttachmentFiles(files, {
    maxAttachments: LIVECODE_MAX_ATTACHMENTS,
    getList: function() { return window.livecodePendingAttachments || []; },
    setList: function(list) { window.livecodePendingAttachments = list; },
    loadingKey: "livecodeAttachmentsLoadingCount",
    onAttachment: function(attachment) {
      if (!attachment.id) attachment.id = window._livecodeMakeAttachmentId();
      var list = window.livecodePendingAttachments || [];
      // Avoid duplicate chips when the same id somehow re-enters
      if (list.some(function(a) { return a && a.id === attachment.id; })) {
        window._livecodeRouteAttachmentToComposer(attachment);
        return;
      }
      list.push(attachment);
      window.livecodePendingAttachments = list;
      window._livecodeRouteAttachmentToComposer(attachment);
    },
    onUpdate: function() {
      window.updateLivecodeComposerSendState();
    }
  });
};

window.areLivecodeAttachmentsReady = function() {
  return (window.livecodeAttachmentsLoadingCount || 0) === 0;
};

window.updateLivecodeComposerSendState = function() {
  var loading = (window.livecodeAttachmentsLoadingCount || 0) > 0;
  var composer = document.getElementById("livecode-chat-composer");
  if (composer) {
    composer.classList.toggle("is-attachments-loading", loading);
  }
  var sendBtn = document.querySelector("#livecode-chat-composer .chatbot-composer-send-btn");
  if (sendBtn) {
    sendBtn.disabled = loading;
    sendBtn.title = loading ? "Waiting for files to finish loading" : "Send";
    sendBtn.setAttribute("aria-label", loading ? "Waiting for files" : "Send");
  }
};

window.buildLivecodeAttachmentChipElement = function(attachment, options) {
  return window.buildLivecodeInlineFileChipElement(attachment, options);
};

window.buildLivecodeDragGhostPillHtml = function(fileName) {
  var name = String(fileName || "file");
  var isJson = /\.json$/i.test(name);
  var iconSrc = typeof window.getFileIcon === "function"
    ? window.getFileIcon(name)
    : "/asset/file-icons/default_file.svg";
  return '<div class="livecode-drag-ghost-pill-inner livecode-inline-file-chip' + (isJson ? " livecode-json-pill" : "") + '">' +
    '<img src="' + iconSrc + '" class="livecode-inline-file-icon" alt="" aria-hidden="true" onerror="this.onerror=null;this.src=\'' + window.DEFAULT_FILE_ICON + '\'">' +
    '<span class="livecode-inline-file-name">' + (window.shortenStartExtFilename ? window.shortenStartExtFilename(name, 28) : name) + "</span>" +
    "</div>";
};

window.updateLivecodeAttachmentChipUI = function() {
  /* Legacy no-op: inline composer routes attachments on insert. */
};

window.removeLivecodeAttachment = function(index) {
  var list = window.livecodePendingAttachments || [];
  if (typeof index === "number" && index >= 0 && index < list.length) {
    window.removeLivecodeAttachmentById(list[index].id);
  }
  return false;
};

window.triggerLivecodeFileAttach = function() {
  window._livecodeInsertRange = window._livecodeGetComposerSelectionRange();
  var fileInput = document.getElementById("livecode-attach-file-input");
  if (fileInput) {
    fileInput.value = "";
    fileInput.click();
  }
  return false;
};

window.buildLivecodeImageThumbnailsRow = function(images, options) {
  options = options || {};
  images = (images || []).filter(function(a) {
    return a && a.type === "image" && a.data;
  });
  if (!images.length) return null;

  var thumbRow = document.createElement("div");
  thumbRow.className = "livecode-user-image-thumbnails";
  images.forEach(function(imgAtt) {
    var wrap = document.createElement("div");
    wrap.className = "livecode-image-thumb-wrap theme-transition" + (options.readonly ? " readonly" : "");
    wrap.setAttribute("data-attachment-id", imgAtt.id || "");
    var img = document.createElement("img");
    img.className = "livecode-image-thumb";
    img.src = imgAtt.data;
    img.alt = imgAtt.name || "image";
    wrap.appendChild(img);
    thumbRow.appendChild(wrap);
  });
  return thumbRow;
};

window.buildLivecodeUserMessageElement = function(displayPayload) {
  displayPayload = displayPayload || {};
  var block = document.createElement("div");
  block.className = "chat-user-block";

  var attMap = {};
  (displayPayload.attachments || []).forEach(function(a) {
    if (a && a.id) attMap[a.id] = a;
  });

  var images = (displayPayload.attachments || []).filter(function(a) {
    return a && a.type === "image" && a.data;
  });
  var segments = displayPayload.segments;
  var text = String(displayPayload.text || "").trim();
  var hasSegments = segments && segments.length;
  var hasImages = images.length > 0;
  var hasTextContent = hasSegments || text;

  if (hasImages || hasTextContent) {
    var msgEl = document.createElement("div");
    msgEl.className = "chat-msg user livecode-user-inline";

    if (hasImages) {
      var thumbRow = window.buildLivecodeImageThumbnailsRow(images, { readonly: true });
      if (thumbRow) msgEl.appendChild(thumbRow);
    }

    if (hasSegments) {
      segments.forEach(function(seg) {
        if (!seg) return;
        if (seg.type === "text" && seg.value) {
          msgEl.appendChild(document.createTextNode(seg.value));
        } else if (seg.type === "file" && seg.attachment_id && attMap[seg.attachment_id]) {
          msgEl.appendChild(window.buildLivecodeInlineFileChipElement(attMap[seg.attachment_id], { readonly: true }));
        }
      });
    } else if (text) {
      msgEl.appendChild(document.createTextNode(text));
    }

    if (msgEl.childNodes.length) block.appendChild(msgEl);
  }

  return block;
};

window.renderLivecodeUserMessage = function(output, displayPayload) {
  if (!output) return null;
  displayPayload = displayPayload || {};
  var hasContent = (displayPayload.text || "").trim() ||
    (displayPayload.segments && displayPayload.segments.length) ||
    (displayPayload.attachments && displayPayload.attachments.length);
  if (!hasContent) return null;

  var userRow = document.createElement("div");
  userRow.className = "chat-row livecode-user-row";
  userRow.appendChild(window.buildLivecodeUserMessageElement(displayPayload));
  output.appendChild(userRow);
  return userRow;
};

window.serializeLivecodeDisplayPayload = function(state) {
  state = state || window.getLivecodeComposerState();
  return {
    text: state.text || "",
    segments: (state.segments || []).slice(),
    attachments: (state.attachments || []).slice()
  };
};

window.getLivecodeApiAttachments = function() {
  return (window.livecodePendingAttachments || []).map(function(a) {
    var copy = {
      name: a.name,
      type: a.type || "file",
      size: a.size || 0
    };
    if (a.type === "image" && a.data) {
      copy.data = a.data;
    } else if (a.type === "repo_file" || a.type === "repo_folder") {
      copy.repo_path = a.repo_path || "";
    } else if (a.type === "binary") {
      copy.content = a.content || "";
      if (a.note) copy.note = a.note;
    } else if (a.content !== undefined) {
      copy.content = a.content;
      if (a.truncated) copy.truncated = true;
      if (a.pageCount !== undefined) copy.pageCount = a.pageCount;
    }
    return copy;
  });
};

window.enrichLivecodeAgentQuestion = function(command, attachments) {
  attachments = attachments || [];
  if (!attachments.length) return command || "";
  var textAttachments = attachments.filter(function(a) {
    return a && a.type !== "image" && a.type !== "binary" && a.type !== "repo_file" && a.type !== "repo_folder" && (a.content || a.content === "");
  });
  var binaryAttachments = attachments.filter(function(a) {
    return a && a.type === "binary";
  });
  var imageAttachments = attachments.filter(function(a) {
    return a && a.type === "image" && a.data;
  });
  var parts = [];
  if (command && String(command).trim()) {
    parts.push(String(command).trim());
  } else if (attachments.length) {
    parts.push(window.buildChatAttachmentPrompt(attachments));
  }
  if (textAttachments.length > 0) {
    var fileContents = textAttachments.map(function(a) {
      var header = "--- File: " + a.name + " ---";
      if (a.truncated) {
        header += " (truncated, original size: " + (a.size / 1024).toFixed(1) + " KB)";
      }
      var content = a.content || "(empty file)";
      return header + "\n" + content + "\n--- End of " + a.name + " ---";
    }).join("\n\n");
    parts.push("Attached file content:\n" + fileContents);
  }
  if (binaryAttachments.length > 0) {
    parts.push(
      "Attached binary file(s) (name only, content not inlined): " +
      binaryAttachments.map(function(a) {
        return a.name + (a.size ? " (" + Math.round(a.size / 1024) + " KB)" : "");
      }).join(", ")
    );
  }
  if (imageAttachments.length > 0) {
    parts.push(
      "Attached image file(s) (visual reference only): " +
      imageAttachments.map(function(a) { return a.name; }).join(", ")
    );
  }
  return parts.join("\n\n");
};
let ideEditor = null;

let ideTerminal = null;

let ideFitAddon = null;

let ideTerminalInitialized = false;

let ideFileTree = {};

let ideOpenFiles = {};

let ideActiveFile = null;

let ideExpandedFolders = new Set;

let livecodeProjectPath = null;
window.getLiveCodeProjectPath = function() { return livecodeProjectPath; };

let livecodeProjectName = null;

let livecodeAgentSessionId = null;

let livecodeAgentRunning = false;

let livecodeChatTabs = [];

let livecodeActiveChatTabId = null;

let livecodeChatTabCounter = 0;

let livecodeTabsByProject = {};

let _livecodeIdeSocket = null;

function _livecodeGetIdeSocket() {
  if (_livecodeIdeSocket) return _livecodeIdeSocket;
  _livecodeIdeSocket = (typeof socket !== "undefined" && socket)
    ? socket
    : io.connect(location.protocol + "//" + location.host, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
      });
  return _livecodeIdeSocket;
}

const LIVECODE_IDE_SOCKET_TIMEOUT_MS = 15000;

function _livecodeIdeSocketRequest(emitEvent, payload, responseEvent, matchFn, timeoutMs) {
  void responseEvent;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  if (controller && timeoutMs) {
    timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  }
  return fetch("/socket-emit/" + encodeURIComponent(emitEvent), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    signal: controller ? controller.signal : undefined,
  }).then(function(resp) {
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return resp.json();
  }).then(function(body) {
    const data = body && body.payload ? body.payload : {};
    if (matchFn && !matchFn(data)) {
      return { error: "no_match", data: data };
    }
    return { data: data };
  }).catch(function(err) {
    return { error: "http_error", data: { error: String(err && err.message || err) } };
  }).finally(function() {
    if (timer) clearTimeout(timer);
  });
}

const LIVECODE_CHAT_MODES = [
  { value: "agent", label: "Agent", placeholder: "Build, fix, or explain..." },
  { value: "plan", label: "Plan", placeholder: "Plan an approach..." },
  { value: "ask", label: "Ask", placeholder: "Ask a question..." },
];

const LIVECODE_CHAT_MODE_STORAGE_KEY = "livecode-chat-mode";

const _LIVECODE_MODE_ICON_SVGS = {
  agent:
    '<svg class="livecode-mode-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M6.75 9C5.1393 9 3.75 10.1979 3.75 12C3.75 13.8021 5.1393 15 6.75 15C8.93215 15 9.96658 13.7213 11.0909 12.0197C9.9648 10.2963 8.94769 9 6.75 9ZM11.9886 10.6591C10.9022 9.07118 9.47531 7.5 6.75 7.5C4.37993 7.5 2.25 9.30208 2.25 12C2.25 14.6979 4.37993 16.5 6.75 16.5C9.45251 16.5 10.8909 14.9553 11.9845 13.3798C12.4189 14.0069 12.9091 14.6294 13.5048 15.1451C14.4451 15.9593 15.6342 16.5 17.25 16.5C19.6201 16.5 21.75 14.6979 21.75 12C21.75 9.30208 19.6201 7.5 17.25 7.5C14.5253 7.5 13.0855 9.07015 11.9886 10.6591ZM12.8809 12.023C13.3905 12.8006 13.8793 13.4853 14.4866 14.0111C15.1705 14.6032 16.0158 15 17.25 15C18.8607 15 20.25 13.8021 20.25 12C20.25 10.1979 18.8607 9 17.25 9C15.0496 9 14.0162 10.3002 12.8809 12.023Z" fill="currentColor"></path></svg>',
  plan:
    '<svg class="livecode-mode-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line>' +
    '<circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"></circle>' +
    '<circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"></circle>' +
    '<circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"></circle></svg>',
  ask:
    '<svg class="livecode-mode-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
};

const _LIVECODE_MODE_DROPDOWN_STYLE =
  "display:none;position:fixed;min-width:180px;max-height:320px;overflow:hidden;" +
  "border:1px solid rgba(71,85,105,0.4);border-radius:12px;box-shadow:0 -4px 20px rgba(0,0,0,0.3);" +
  "z-index:10050;flex-direction:column;";

function _livecodeGetModeIconHtml(modeValue, extraClass) {
  const svg = _LIVECODE_MODE_ICON_SVGS[modeValue] || _LIVECODE_MODE_ICON_SVGS.agent;
  if (!extraClass) return svg;
  const cls = String(extraClass || "").trim();
  const suffix = cls ? (" " + cls) : "";
  return svg.replace('class="livecode-mode-icon-svg"', 'class="livecode-mode-icon-svg' + suffix + '"');
}

const _LIVECODE_RUNNING_ICON_LINES =
  '<line x1="12" y1="4" x2="12" y2="7"></line>' +
  '<line x1="12" y1="4" x2="12" y2="7" transform="rotate(45 12 12)"></line>' +
  '<line x1="12" y1="4" x2="12" y2="7" transform="rotate(90 12 12)"></line>' +
  '<line x1="12" y1="4" x2="12" y2="7" transform="rotate(135 12 12)"></line>' +
  '<line x1="12" y1="4" x2="12" y2="7" transform="rotate(180 12 12)"></line>' +
  '<line x1="12" y1="4" x2="12" y2="7" transform="rotate(225 12 12)"></line>' +
  '<line x1="12" y1="4" x2="12" y2="7" transform="rotate(270 12 12)"></line>' +
  '<line x1="12" y1="4" x2="12" y2="7" transform="rotate(315 12 12)"></line>';
const LIVECODE_CHAT_TAB_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
const _LIVECODE_TAB_MESSAGE_ICON = LIVECODE_CHAT_TAB_ICON;
const _LIVECODE_TAB_SPINNER_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + _LIVECODE_RUNNING_ICON_LINES + '</svg>';

function _livecodeGetTabIconHtml(tab) {
  if (tab && tab.agentRunning) return _LIVECODE_TAB_SPINNER_ICON;
  return _LIVECODE_TAB_MESSAGE_ICON;
}

function _livecodeClearTabUnread(tab) {
  if (tab) tab.hasUnread = false;
}

let livecodeIndexReady = false;
let livecodeIndexFileCount = 0;

const LIVECODE_LAST_PROJECT_KEY = "livecode_last_project";

const LIVECODE_BROWSER_LAST_PATH_KEY = "livecodeBrowserLastPath";

const LIVECODE_RECENT_PROJECTS_KEY = "livecode_recent_projects";

const LIVECODE_SESSIONS_KEY_PREFIX = "livecode_session_";

const LIVECODE_TABS_STORAGE_PREFIX = "livecode_tabs_v1:";

const LIVECODE_CHAT_STORAGE_PREFIX = "livecode_chat_v1:";

const LIVECODE_EDITOR_TABS_STORAGE_PREFIX = "livecode_editor_tabs_v1:";

function _livecodeStorageGet(key) {
  if (!key) return null;
  try {
    const fromLocal = localStorage.getItem(key);
    if (fromLocal != null) return fromLocal;
    return sessionStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function _livecodeStorageSet(key, value) {
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {}
  try {
    sessionStorage.setItem(key, value);
  } catch (e) {}
}

function _livecodeStorageRemove(key) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (e) {}
  try {
    sessionStorage.removeItem(key);
  } catch (e) {}
}

function _livecodeSessionStorageKey(projectPath) {
  return LIVECODE_SESSIONS_KEY_PREFIX + String(projectPath || "");
}

function _livecodeSaveSessionForProject(projectPath, sessionId) {
  if (!projectPath || !sessionId) return;
  try {
    localStorage.setItem(_livecodeSessionStorageKey(projectPath), sessionId);
  } catch (e) {}
}

function _livecodeClearSessionForProject(projectPath) {
  if (!projectPath) return;
  try {
    localStorage.removeItem(_livecodeSessionStorageKey(projectPath));
  } catch (e) {}
}

function _livecodeTabHasConversation(tab) {
  return !!(tab && (tab.chatStarted || (tab.messagesHtml && String(tab.messagesHtml).trim())));
}

function _livecodeResetTabToNewChat(tab) {
  if (!tab) return;
  const newId = _livecodeNewChatSessionId();
  tab.sessionId = newId;
  tab.title = "New chat";
  tab.messagesHtml = "";
  tab.chatStarted = false;
  tab.hasUnread = false;
  livecodeAgentSessionId = newId;
  _livecodeChatStarted = false;
  if (livecodeProjectPath) {
    _livecodeClearSessionForProject(livecodeProjectPath);
  }
  _livecodeLoadChatTabState(tab);
  _livecodeUpdateChatWelcome();
  _livecodeRenderChatTabs();
}

const LIVECODE_SESSION_ID_PATTERN = /^livecode_(?:[a-f0-9]{32}|\d{10,}_[a-z0-9]+)$/;

function _livecodeLoadSessionForProject(projectPath) {
  if (!projectPath) return null;
  try {
    const stored = localStorage.getItem(_livecodeSessionStorageKey(projectPath));
    if (stored && LIVECODE_SESSION_ID_PATTERN.test(stored)) return stored;
    if (stored) localStorage.removeItem(_livecodeSessionStorageKey(projectPath));
    return null;
  } catch (e) {
    return null;
  }
}

function _livecodeChatSnapshotKey(projectPath, sessionId) {
  const project = _livecodeNormalizeProjectKey(projectPath);
  const sid = String(sessionId || "").trim();
  if (!project || !sid) return "";
  return LIVECODE_CHAT_STORAGE_PREFIX + project + ":" + sid;
}

function _livecodePersistChatSnapshot(projectPath, tab) {
  if (!tab || !projectPath || !tab.sessionId) return;
  if (tab.id === livecodeActiveChatTabId && !tab.agentRunning) {
    const out = getLiveCodeChatOutput();
    if (out) {
      _livecodeFinalizeDomForSnapshot(out);
      tab.messagesHtml = out.innerHTML;
    }
  }
  if (!tab.messagesHtml) return;
  const key = _livecodeChatSnapshotKey(projectPath, tab.sessionId);
  if (!key) return;
  try {
    _livecodeStorageSet(key, JSON.stringify({
      messagesHtml: tab.messagesHtml,
      title: tab.title || "",
      chatStarted: !!tab.chatStarted,
      updatedAt: Date.now(),
    }));
  } catch (e) {}
}

function _livecodeLoadChatSnapshot(projectPath, sessionId) {
  const key = _livecodeChatSnapshotKey(projectPath, sessionId);
  if (!key) return null;
  try {
    const raw = _livecodeStorageGet(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function _livecodePersistTabsStorage(projectPath) {
  const project = _livecodeNormalizeProjectKey(projectPath);
  if (!project) return;
  try {
    _livecodeStorageSet(LIVECODE_TABS_STORAGE_PREFIX + project, JSON.stringify({
      tabs: livecodeChatTabs.map(_livecodeSnapshotTab),
      activeTabId: livecodeActiveChatTabId,
      tabCounter: livecodeChatTabCounter,
    }));
  } catch (e) {}
}

function _livecodeLoadTabsStorage(projectPath) {
  const project = _livecodeNormalizeProjectKey(projectPath);
  if (!project) return null;
  try {
    const raw = _livecodeStorageGet(LIVECODE_TABS_STORAGE_PREFIX + project);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function _livecodePersistEditorTabs(projectPath) {
  const project = _livecodeNormalizeProjectKey(projectPath);
  if (!project) return;
  const openPaths = Object.keys(ideOpenFiles);
  const key = LIVECODE_EDITOR_TABS_STORAGE_PREFIX + project;
  if (!openPaths.length) {
    _livecodeStorageRemove(key);
    return;
  }
  try {
    _livecodeStorageSet(key, JSON.stringify({
      openPaths: openPaths,
      activeFile: ideActiveFile && ideOpenFiles[ideActiveFile] ? ideActiveFile : openPaths[openPaths.length - 1],
    }));
  } catch (e) {}
}

let _livecodePersistEditorTabsTimer = null;
let _livecodeEditorAutosaveBound = false;
let _livecodeEditorAutosaveTimer = null;

function _livecodeFlushPersistEditorTabs() {
  if (_livecodePersistEditorTabsTimer) {
    clearTimeout(_livecodePersistEditorTabsTimer);
    _livecodePersistEditorTabsTimer = null;
  }
  if (livecodeProjectPath) _livecodePersistEditorTabs(livecodeProjectPath);
}

function _livecodePersistEditorTabsDebounced(projectPath) {
  if (!projectPath) return;
  if (_livecodePersistEditorTabsTimer) clearTimeout(_livecodePersistEditorTabsTimer);
  _livecodePersistEditorTabsTimer = setTimeout(function() {
    _livecodePersistEditorTabsTimer = null;
    _livecodePersistEditorTabs(projectPath);
  }, 400);
}

function _livecodeBindEditorAutosaveOnce() {
  if (_livecodeEditorAutosaveBound || !window.ideEditor) return;
  _livecodeEditorAutosaveBound = true;
  window.ideEditor.onDidChangeModelContent(function() {
    if (!ideActiveFile || !ideOpenFiles[ideActiveFile]) return;
    const fileInfo = ideOpenFiles[ideActiveFile];
    if (_livecodeFileUsesPlanSurface(fileInfo) && fileInfo.viewMode === "markdown") return;
    const currentContent = window.ideEditor.getValue();
    const originalContent = fileInfo.originalContent || "";
    const isModified = currentContent !== originalContent;
    if (fileInfo.modified !== isModified) {
      fileInfo.modified = isModified;
      _livecodeUpdateOpenFileTabBadge(ideActiveFile);
    }
    if (isModified) {
      clearTimeout(_livecodeEditorAutosaveTimer);
      _livecodeEditorAutosaveTimer = setTimeout(function() {
        autoSaveIDEFile(ideActiveFile);
      }, 1e3);
    }
  });
}

function _livecodeLoadEditorTabsStorage(projectPath) {
  const project = _livecodeNormalizeProjectKey(projectPath);
  if (!project) return null;
  try {
    const raw = _livecodeStorageGet(LIVECODE_EDITOR_TABS_STORAGE_PREFIX + project);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.openPaths) || !parsed.openPaths.length) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function _livecodeClearEditorFiles() {
  Object.keys(ideOpenFiles).forEach(function(filePath) {
    const info = ideOpenFiles[filePath];
    if (info && info.model) {
      try {
        info.model.dispose();
      } catch (e) {}
    }
  });
  ideOpenFiles = {};
  ideActiveFile = null;
}

function _livecodeRestoreEditorTabs(projectPath) {
  const saved = _livecodeLoadEditorTabsStorage(projectPath);
  if (!saved || !saved.openPaths || !saved.openPaths.length) {
    showLiveCodeEditorIdle();
    return;
  }
  const paths = saved.openPaths.filter(function(p) { return !!p; });
  if (!paths.length) {
    showLiveCodeEditorIdle();
    return;
  }
  const active = saved.activeFile && paths.indexOf(saved.activeFile) !== -1
    ? saved.activeFile
    : paths[paths.length - 1];
  const backgroundPaths = paths.filter(function(p) { return p !== active; });

  function _livecodeLoadEditorTabFile(filePath, onDone) {
    if (ideOpenFiles[filePath]) {
      onDone();
      return;
    }
    if (_livecodeIsPlanTabKey(filePath)) {
      const planFile = filePath.slice(LIVECODE_PLAN_TAB_PREFIX.length);
      window.openLiveCodePlanTab(planFile, "", { activate: false }).then(onDone);
      return;
    }
    _livecodeIdeSocketRequest(
      "ide_read_file", { path: filePath },
      "ide_file_content",
      function(data) { return data && data.path === filePath; }
    ).then(function(result) {
      const data = result.data;
      if (!data.error) {
        const content = data.content || "";
        const fileName = filePath.split("/").pop();
        ideOpenFiles[filePath] = {
          content: content,
          path: filePath,
          name: fileName,
          modified: false,
          originalContent: content,
          readOnlyLarge: !!data.large_file,
        };
      } else if (result.error) {
        console.error("LiveCode: failed to restore tab for", filePath, data.error);
      }
      onDone();
    });
  }

  _livecodeLoadEditorTabFile(active, function() {
    if (ideOpenFiles[active]) {
      switchToFile(active);
    } else {
      const remaining = Object.keys(ideOpenFiles);
      if (remaining.length) switchToFile(remaining[remaining.length - 1]);
      else showLiveCodeEditorIdle();
    }
    updateOpenFilesList(true);
    updatePlayButtonVisibility();
    _livecodePersistEditorTabsDebounced(projectPath);
    backgroundPaths.forEach(function(filePath) {
      _livecodeLoadEditorTabFile(filePath, function() {});
    });
  });
}

function _livecodeSaveProjectUiState() {
  if (!livecodeProjectPath) return;
  _livecodeSaveTabsForProject(livecodeProjectPath);
  _livecodeFlushPersistEditorTabs();
}

let _livecodeProjectStateListenersBound = false;

function _livecodeBindProjectStateListenersOnce() {
  if (_livecodeProjectStateListenersBound) return;
  _livecodeProjectStateListenersBound = true;
  window.addEventListener("pagehide", _livecodeSaveProjectUiState);
  window.addEventListener("beforeunload", _livecodeSaveProjectUiState);
}

function _livecodePostProcessRestoredOutput(out) {
  if (!out) return;
  _livecodeFlattenThoughtBlocks(out);
  if (typeof window.rehydrateLivecodeChatMarkdown === "function") {
    window.rehydrateLivecodeChatMarkdown(out);
  }
  if (typeof decorateCodeBlocks === "function") {
    out.querySelectorAll(".livecode-code-card").forEach(function(card) {
      decorateCodeBlocks(card);
    });
  }
  if (typeof window._decorateChatLinksGlobal === "function") {
    out.querySelectorAll(".livecode-assistant-row .livecode-plain-msg").forEach(function(el) {
      if (_livecodeShouldSkipMarkdownRehydrate(el)) return;
      window._decorateChatLinksGlobal(el);
    });
  }
}

function _livecodeApplySnapshotToTab(tab, sessionId, snap) {
  if (!tab || !snap || !snap.messagesHtml) return false;
  tab.sessionId = sessionId;
  tab.messagesHtml = snap.messagesHtml;
  tab.chatStarted = true;
  tab.title = _livecodeTruncateTabTitle(snap.title || tab.title || "New chat");
  livecodeAgentSessionId = sessionId;
  _livecodeSaveSessionForProject(livecodeProjectPath, sessionId);
  _livecodeChatStarted = true;
  _livecodeShowChatContainer();
  _livecodeLoadChatTabState(tab);
  _livecodePostProcessRestoredOutput(getLiveCodeChatOutput());
  _livecodeRenderChatTabs();
  return true;
}

function _livecodeClearChatSnapshot(projectPath, sessionId) {
  const key = _livecodeChatSnapshotKey(projectPath, sessionId);
  if (!key) return;
  _livecodeStorageRemove(key);
}

function _livecodeResolveSessionTitle(session) {
  const sid = (session && session.session_id) || "";
  if (!sid) return "Chat";
  if (session.title) return session.title;
  if (livecodeProjectPath) {
    const pending = _livecodeGetPendingSessionTitles(livecodeProjectPath);
    if (pending[sid]) return pending[sid];
  }
  const tab = livecodeChatTabs.find(function(t) { return t.sessionId === sid; });
  if (tab && tab.title && tab.title !== "New chat" && tab.title !== "Loading…") {
    return tab.title;
  }
  return session.first_user_preview || sid || "Chat";
}

function _livecodeUpsertPendingSession(sessionId, title) {
  if (!sessionId || !title || !livecodeProjectPath) return;
  const pending = _livecodeGetPendingSessionTitles(livecodeProjectPath);
  pending[sessionId] = title;
  let found = false;
  let cached = _livecodeGetCachedSessions(livecodeProjectPath).slice();
  cached = cached.map(function(s) {
    if (s.session_id !== sessionId) return s;
    found = true;
    return Object.assign({}, s, { title: title });
  });
  if (!found) {
    cached.unshift({
      session_id: sessionId,
      title: title,
      updated_at: Date.now() / 1000,
    });
  }
  _livecodeSetCachedSessions(livecodeProjectPath, cached);
}

function _livecodePurgeDeletedSession(sessionId) {
  if (!sessionId || !livecodeProjectPath) return;
  const pending = _livecodeGetPendingSessionTitles(livecodeProjectPath);
  delete pending[sessionId];
  _livecodeClearChatSnapshot(livecodeProjectPath, sessionId);
  _livecodeSetCachedSessions(livecodeProjectPath, _livecodeGetCachedSessions(livecodeProjectPath).filter(function(s) {
    return s.session_id !== sessionId;
  }));
  if (_livecodeLoadSessionForProject(livecodeProjectPath) === sessionId) {
    _livecodeClearSessionForProject(livecodeProjectPath);
  }
  const tabsForSession = livecodeChatTabs.filter(function(t) { return t.sessionId === sessionId; });
  tabsForSession.forEach(function(tab) {
    if (tab.agentRunning) return;
    if (livecodeChatTabs.length <= 1) {
      _livecodeResetTabToNewChat(tab);
    } else {
      _livecodeCloseChatTab(tab.id);
    }
  });
}

function _livecodeFormatSessionTime(ts) {
  const n = Number(ts);
  if (!n || Number.isNaN(n)) return "";
  try {
    const d = new Date(n * 1000);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

var _livecodeCachedSessionsByProject = {};
var _livecodePendingSessionTitlesByProject = {};
var _livecodeSessionFetchToken = 0;
var _livecodeSessionMenuOpen = false;

function _livecodeGetPendingSessionTitles(projectPath) {
  const key = _livecodeNormalizeProjectKey(projectPath);
  if (!key) return {};
  if (!_livecodePendingSessionTitlesByProject[key]) {
    _livecodePendingSessionTitlesByProject[key] = {};
  }
  return _livecodePendingSessionTitlesByProject[key];
}

function _livecodeGetCachedSessions(projectPath) {
  const key = _livecodeNormalizeProjectKey(projectPath);
  if (!key) return [];
  return _livecodeCachedSessionsByProject[key] || [];
}

function _livecodeSetCachedSessions(projectPath, sessions) {
  const key = _livecodeNormalizeProjectKey(projectPath);
  if (!key) return;
  _livecodeCachedSessionsByProject[key] = sessions;
}

function _livecodeResetSessionMenuForProject(projectPath) {
  const key = _livecodeNormalizeProjectKey(projectPath);
  if (!key) return;
  delete _livecodeCachedSessionsByProject[key];
  delete _livecodePendingSessionTitlesByProject[key];
}

function _livecodeInvalidateSessionFetches() {
  _livecodeSessionFetchToken++;
}
var _livecodeSessionMenuPositionBound = false;

function _livecodeEnsureSessionMenuPortal() {
  const menu = document.getElementById("livecode-chat-session-menu");
  if (menu && menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
}

function _livecodePositionSessionMenu() {
  const menu = document.getElementById("livecode-chat-session-menu");
  const btn = document.getElementById("livecode-chat-session-history");
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  const gap = 4;
  const viewportPad = 8;
  menu.style.top = Math.max(viewportPad, rect.bottom + gap) + "px";
  menu.style.right = Math.max(viewportPad, window.innerWidth - rect.right) + "px";
  menu.style.left = "auto";
  const maxH = Math.min(420, window.innerHeight - rect.bottom - gap - viewportPad);
  menu.style.maxHeight = Math.max(160, maxH) + "px";
}

function _livecodeOnSessionMenuReposition() {
  if (!_livecodeSessionMenuOpen) return;
  _livecodePositionSessionMenu();
}

function _livecodeBindSessionMenuReposition() {
  if (_livecodeSessionMenuPositionBound) return;
  _livecodeSessionMenuPositionBound = true;
  window.addEventListener("resize", _livecodeOnSessionMenuReposition, true);
  document.addEventListener("scroll", _livecodeOnSessionMenuReposition, true);
}

function _livecodeUnbindSessionMenuReposition() {
  if (!_livecodeSessionMenuPositionBound) return;
  _livecodeSessionMenuPositionBound = false;
  window.removeEventListener("resize", _livecodeOnSessionMenuReposition, true);
  document.removeEventListener("scroll", _livecodeOnSessionMenuReposition, true);
}

const _LIVECODE_SESSION_CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="9 12 11 14 15 10"></polyline></svg>';
const _LIVECODE_SESSION_RUNNING_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + _LIVECODE_RUNNING_ICON_LINES + '</svg>';

const LIVECODE_SESSIONS_FETCH_TIMEOUT_MS = 20000;

function _livecodeMarkSessionsFetchFailed(list) {
  const result = list || [];
  result._livecodeFetchFailed = true;
  return result;
}

function _livecodeFetchSessions(projectPath) {
  if (!projectPath) return Promise.resolve([]);
  const hasAbort = typeof AbortController !== "undefined";
  const controller = hasAbort ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(function() { controller.abort(); }, LIVECODE_SESSIONS_FETCH_TIMEOUT_MS) : null;
  return fetch(
    "/livecode/sessions?project_path=" + encodeURIComponent(projectPath) + "&limit=30",
    controller ? { signal: controller.signal } : undefined
  )
    .then(function(r) {
      if (timeoutId) clearTimeout(timeoutId);
      return r.json().then(function(data) {
        if (!r.ok || !data || !data.success) {
          console.error("LiveCode: failed to load sessions for", projectPath, (data && data.error) || r.status);
          return _livecodeMarkSessionsFetchFailed([]);
        }
        return data.sessions || [];
      });
    })
    .catch(function(err) {
      if (timeoutId) clearTimeout(timeoutId);
      console.error("LiveCode: failed to load sessions for", projectPath, err);
      return _livecodeMarkSessionsFetchFailed([]);
    });
}

function _livecodeGroupSessionsByDate(sessions) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = { today: [], yesterday: [], older: [] };
  (sessions || []).forEach(function(s) {
    const ts = Number(s.updated_at);
    if (!ts || Number.isNaN(ts)) {
      groups.older.push(s);
      return;
    }
    const d = new Date(ts * 1000);
    if (d.toDateString() === today.toDateString()) groups.today.push(s);
    else if (d.toDateString() === yesterday.toDateString()) groups.yesterday.push(s);
    else groups.older.push(s);
  });
  return groups;
}

function _livecodeUnbindSessionItemMenuReposition(menu) {
  if (!menu || !menu._livecodeRepositionHandler) return;
  window.removeEventListener("resize", menu._livecodeRepositionHandler, true);
  document.removeEventListener("scroll", menu._livecodeRepositionHandler, true);
  menu._livecodeRepositionHandler = null;
}

function _livecodeCloseSessionItemMenus() {
  document.querySelectorAll(".livecode-chat-session-item-menu").forEach(function(menu) {
    _livecodeUnbindSessionItemMenuReposition(menu);
    if (menu.classList.contains("is-portaled")) {
      menu.remove();
    } else {
      menu.style.display = "none";
    }
  });
}

window.closeChatMenus = window.closeChatMenus || function() {
  _livecodeCloseSessionItemMenus();
};

window.showRenameModal = window.showRenameModal || function(currentTitle, onSubmit) {
  if (typeof onSubmit !== "function") return;
  var overlay = document.createElement("div");
  overlay.className = "livecode-rename-modal-overlay theme-transition";
  overlay.innerHTML =
    '<div class="livecode-rename-modal theme-transition" role="dialog" aria-label="Rename chat">' +
    '<div class="livecode-rename-modal-title">Rename chat</div>' +
    '<input type="text" class="livecode-rename-modal-input theme-transition" maxlength="120" />' +
    '<div class="livecode-rename-modal-actions">' +
    '<button type="button" class="btn btn-ghost livecode-rename-modal-cancel">Cancel</button>' +
    '<button type="button" class="btn btn-primary livecode-rename-modal-save">Save</button>' +
    "</div></div>";
  var input = overlay.querySelector(".livecode-rename-modal-input");
  var cancelBtn = overlay.querySelector(".livecode-rename-modal-cancel");
  var saveBtn = overlay.querySelector(".livecode-rename-modal-save");
  input.value = String(currentTitle || "");
  function closeModal() {
    overlay.remove();
  }
  function submit() {
    var value = (input.value || "").trim();
    closeModal();
    if (value) onSubmit(value);
  }
  cancelBtn.onclick = closeModal;
  saveBtn.onclick = submit;
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) closeModal();
  });
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
  });
  document.body.appendChild(overlay);
  input.focus();
  input.select();
};

function _livecodePositionSessionItemMenu(menu, anchor) {
  if (!menu || !anchor) return;
  const gap = 4;
  const viewportPad = 8;
  const rect = anchor.getBoundingClientRect();
  menu.style.visibility = "hidden";
  menu.style.display = "flex";
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + gap;
  let left = rect.right - menuRect.width;
  if (left < viewportPad) {
    left = rect.left;
  }
  if (top + menuRect.height > window.innerHeight - viewportPad) {
    top = rect.top - menuRect.height - gap;
  }
  left = Math.max(viewportPad, Math.min(left, window.innerWidth - menuRect.width - viewportPad));
  top = Math.max(viewportPad, Math.min(top, window.innerHeight - menuRect.height - viewportPad));
  menu.style.top = top + "px";
  menu.style.left = left + "px";
  menu.style.visibility = "visible";
}

function _livecodeBindSessionItemMenuReposition(menu, anchor) {
  _livecodeUnbindSessionItemMenuReposition(menu);
  const handler = function() {
    if (!menu.isConnected) {
      _livecodeUnbindSessionItemMenuReposition(menu);
      return;
    }
    _livecodePositionSessionItemMenu(menu, anchor);
  };
  menu._livecodeRepositionHandler = handler;
  window.addEventListener("resize", handler, true);
  document.addEventListener("scroll", handler, true);
}

function _livecodeToggleSessionItemMenu(anchor, buildMenu) {
  if (!anchor || typeof buildMenu !== "function") return;
  var existing = document.querySelector(".livecode-chat-session-item-menu.is-portaled");
  var sameAnchor = existing && existing._livecodeMenuAnchor === anchor;
  _livecodeCloseSessionItemMenus();
  if (sameAnchor) return;
  var menu = buildMenu();
  menu.classList.add("is-portaled");
  menu._livecodeMenuAnchor = anchor;
  document.body.appendChild(menu);
  _livecodePositionSessionItemMenu(menu, anchor);
  _livecodeBindSessionItemMenuReposition(menu, anchor);
}

function _livecodeBuildSessionMoreMenu(sessionId, currentTitle) {
  const menu = document.createElement("div");
  menu.className = "chat-history-menu livecode-chat-session-item-menu";
  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "chat-history-menu-item";
  renameBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8.00012L4 16.0001V20.0001L8 20.0001L16 12.0001M12 8.00012L14.8686 5.13146L14.8704 5.12976C15.2652 4.73488 15.463 4.53709 15.691 4.46301C15.8919 4.39775 16.1082 4.39775 16.3091 4.46301C16.5369 4.53704 16.7345 4.7346 17.1288 5.12892L18.8686 6.86872C19.2646 7.26474 19.4627 7.46284 19.5369 7.69117C19.6022 7.89201 19.6021 8.10835 19.5369 8.3092C19.4628 8.53736 19.265 8.73516 18.8695 9.13061L18.8686 9.13146L16 12.0001M12 8.00012L16 12.0001"/></svg>Rename';
  renameBtn.onclick = function(ev) {
    ev.stopPropagation();
    window.renameLiveCodeSession(sessionId, currentTitle, ev);
    _livecodeCloseSessionItemMenus();
  };
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "chat-history-menu-item danger";
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9,3H7c0-1.7,1.3-3,3-3v2C9.4,2,9,2.4,9,3z"/><path d="M17,3h-2c0-0.6-0.4-1-1-1V0C15.7,0,17,1.3,17,3z"/><polygon points="17,6 7,6 7,3 9,3 9,4 15,4 15,3 17,3"/><rect x="10" width="4" height="2"/><path d="M21,6H3C2.4,6,2,5.6,2,5s0.4-1,1-1h18c0.6,0,1,0.4,1,1S21.6,6,21,6z"/><path d="M19,24H5c-0.6,0-1-0.4-1-1V9c0-0.6,0.4-1,1-1h14c0.6,0,1,0.4,1,1v14C20,23.6,19.6,24,19,24z M6,22h12V10H6V22z"/><path d="M10,20c-0.6,0-1-0.4-1-1v-6c0-0.6,0.4-1,1-1s1,0.4,1,1v6C11,19.6,10.6,20,10,20z"/><path d="M14,20c-0.6,0-1-0.4-1-1v-6c0-0.6,0.4-1,1-1s1,0.4,1,1v6C15,19.6,14.6,20,14,20z"/></svg>Delete';
  deleteBtn.onclick = function(ev) {
    ev.stopPropagation();
    window.deleteLiveCodeSession(sessionId, ev);
    _livecodeCloseSessionItemMenus();
  };
  menu.appendChild(renameBtn);
  menu.appendChild(deleteBtn);
  return menu;
}

function _livecodeCreateSessionMenuRow(session) {
  const sid = session.session_id || "";
  const titleText = _livecodeResolveSessionTitle(session);
  const isActive = sid === livecodeAgentSessionId;
  const isRunning = livecodeChatTabs.some(function(t) {
    return t.sessionId === sid && t.agentRunning;
  });
  const hasUnread = !isRunning && livecodeChatTabs.some(function(t) {
    return t.sessionId === sid && t.hasUnread;
  });

  const row = document.createElement("div");
  row.className = "livecode-chat-session-menu-item-row theme-transition" + (hasUnread ? " has-unread" : "");
  row.dataset.sessionId = sid;

  const itemBtn = document.createElement("button");
  itemBtn.type = "button";
  itemBtn.className = "livecode-chat-session-menu-item theme-transition" +
    (isActive ? " is-active" : "") +
    (isRunning ? " is-running" : "");
  const iconSpan = document.createElement("span");
  iconSpan.className = "livecode-chat-session-menu-item-icon";
  iconSpan.innerHTML = isRunning ? _LIVECODE_SESSION_RUNNING_ICON : _LIVECODE_SESSION_CHECK_ICON;
  const titleSpan = document.createElement("span");
  titleSpan.className = "livecode-chat-session-menu-item-title";
  titleSpan.textContent = titleText;
  itemBtn.appendChild(iconSpan);
  itemBtn.appendChild(titleSpan);
  itemBtn.onclick = function(e) {
    if (e.target.closest(".chat-history-menu") || e.target.closest(".livecode-chat-session-menu-item-more")) {
      return;
    }
    _livecodeCloseSessionItemMenus();
    window.resumeLiveCodeSession(sid);
    closeLiveCodeSessionMenu();
  };

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "livecode-chat-session-menu-item-more chat-history-item-more";
  moreBtn.title = "More";
  moreBtn.setAttribute("aria-label", "More options");
  moreBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>';
  moreBtn.onclick = function(e) {
    e.stopPropagation();
    _livecodeToggleSessionItemMenu(moreBtn, function() {
      return _livecodeBuildSessionMoreMenu(sid, titleText);
    });
  };

  row.appendChild(itemBtn);
  row.appendChild(moreBtn);
  return row;
}

function _livecodePopulateSessionMenuList(list, sessions, fetchFailed, projectPath) {
  list.innerHTML = "";
  if (projectPath) {
    const name = projectPath.split("/").filter(Boolean).pop() || projectPath;
    const header = document.createElement("div");
    header.className = "livecode-chat-session-menu-section-label";
    header.textContent = name;
    header.title = projectPath;
    list.appendChild(header);
  }
  if (!sessions || !sessions.length) {
    if (fetchFailed) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "livecode-chat-session-menu-empty livecode-chat-session-menu-retry";
      retry.style.cssText = "width:100%;background:transparent;border:none;color:inherit;cursor:pointer;text-align:left;";
      retry.textContent = "Failed to load sessions — click to retry";
      retry.onclick = function() { renderLiveCodeSessionDropdown(); };
      list.appendChild(retry);
    } else {
      const empty = document.createElement("div");
      empty.className = "livecode-chat-session-menu-empty";
      empty.textContent = "No saved sessions";
      list.appendChild(empty);
    }
    return;
  }
  const groups = _livecodeGroupSessionsByDate(sessions);
  const sections = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "older", label: "Older" },
  ];
  sections.forEach(function(sec) {
    const items = groups[sec.key] || [];
    if (!items.length) return;
    const label = document.createElement("div");
    label.className = "livecode-chat-session-menu-section-label";
    label.textContent = sec.label;
    list.appendChild(label);
    items.forEach(function(s) {
      list.appendChild(_livecodeCreateSessionMenuRow(s));
    });
  });
}

function renderLiveCodeSessionDropdown() {
  const list = document.getElementById("livecode-chat-session-menu-list");
  if (!list) return;
  const projectPath = livecodeProjectPath;
  if (!projectPath) {
    list.innerHTML = '<div class="livecode-chat-session-menu-empty">Open a project to view sessions</div>';
    return;
  }
  const fetchToken = ++_livecodeSessionFetchToken;
  list.innerHTML = '<div class="livecode-chat-session-menu-empty">Loading sessions…</div>';
  _livecodeFetchSessions(projectPath).then(function(sessions) {
    if (fetchToken !== _livecodeSessionFetchToken) return;
    if (_livecodeNormalizeProjectKey(projectPath) !== _livecodeNormalizeProjectKey(livecodeProjectPath)) return;
    const fetchFailed = !!sessions._livecodeFetchFailed;
    const byId = {};
    (sessions || []).forEach(function(s) {
      if (s && s.session_id) byId[s.session_id] = s;
    });
    const pendingTitles = _livecodeGetPendingSessionTitles(projectPath);
    Object.keys(pendingTitles).forEach(function(sid) {
      const pendingTitle = pendingTitles[sid];
      if (!byId[sid]) {
        byId[sid] = { session_id: sid, title: pendingTitle, updated_at: Date.now() / 1000 };
      } else if (!byId[sid].title && pendingTitle) {
        byId[sid].title = pendingTitle;
      }
    });
    livecodeChatTabs.forEach(function(tab) {
      if (!tab.sessionId || !tab.title || tab.title === "New chat" || tab.title === "Loading…") return;
      if (!byId[tab.sessionId]) {
        byId[tab.sessionId] = {
          session_id: tab.sessionId,
          title: tab.title,
          updated_at: Date.now() / 1000,
        };
      }
    });
    const merged = Object.keys(byId).map(function(sid) { return byId[sid]; })
      .sort(function(a, b) { return Number(b.updated_at || 0) - Number(a.updated_at || 0); });
    _livecodeSetCachedSessions(projectPath, merged);
    _livecodePopulateSessionMenuList(list, merged, fetchFailed, projectPath);
    if (_livecodeSessionMenuOpen) _livecodePositionSessionMenu();
  });
}

window.renameLiveCodeSession = function(sessionId, currentTitle, event) {
  if (event) event.stopPropagation();
  if (!sessionId || !livecodeProjectPath || typeof window.showRenameModal !== "function") return false;
  window.showRenameModal(currentTitle || "Chat", function(newTitle) {
    const title = (newTitle || "").trim();
    if (!title) return;
    fetch("/livecode/session/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_path: livecodeProjectPath,
        session_id: sessionId,
        title: title,
      }),
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (!data || !data.success) return;
      const tab = livecodeChatTabs.find(function(t) { return t.sessionId === sessionId; });
      if (tab) {
        tab.title = title;
        _livecodeRenderChatTabs();
      }
      renderLiveCodeSessionDropdown();
    }).catch(function(err) {
      console.error("LiveCode rename session failed:", err);
    });
  });
  return false;
};

function _livecodeResetSessionIfDeleted(sessionId) {
  _livecodePurgeDeletedSession(sessionId);
}

window.deleteLiveCodeSession = function(sessionId, event) {
  if (event) event.stopPropagation();
  if (!sessionId || !livecodeProjectPath) return false;
  const runningTab = livecodeChatTabs.find(function(t) {
    return t.sessionId === sessionId && t.agentRunning;
  });
  if (runningTab) return false;
  fetch("/livecode/session/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_path: livecodeProjectPath,
      session_id: sessionId,
    }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || !data.success) return;
    _livecodePurgeDeletedSession(sessionId);
    if (livecodeProjectPath) _livecodeSaveTabsForProject(livecodeProjectPath);
    renderLiveCodeSessionDropdown();
  }).catch(function(err) {
    console.error("LiveCode delete session failed:", err);
  });
  return false;
};

window.closeLiveCodeSessionMenu = function() {
  const menu = document.getElementById("livecode-chat-session-menu");
  const btn = document.getElementById("livecode-chat-session-history");
  if (menu) menu.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
  _livecodeSessionMenuOpen = false;
  _livecodeUnbindSessionMenuReposition();
  _livecodeCloseSessionItemMenus();
};

window.toggleLiveCodeSessionMenu = function() {
  const menu = document.getElementById("livecode-chat-session-menu");
  const btn = document.getElementById("livecode-chat-session-history");
  if (!menu || !btn) return;
  if (_livecodeSessionMenuOpen) {
    closeLiveCodeSessionMenu();
    return;
  }
  if (typeof closeLiveCodeProjectMenu === "function") closeLiveCodeProjectMenu();
  _livecodeEnsureSessionMenuPortal();
  _livecodeSessionMenuOpen = true;
  _livecodePositionSessionMenu();
  menu.style.display = "flex";
  btn.setAttribute("aria-expanded", "true");
  renderLiveCodeSessionDropdown();
  _livecodeBindSessionMenuReposition();
};

var _livecodeProjectMenuOpen = false;
var _livecodeProjectMenuPositionBound = false;

function _livecodeEnsureProjectMenuPortal() {
  const menu = document.getElementById("livecode-project-menu");
  if (menu && menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
}

function _livecodePositionProjectMenu() {
  const menu = document.getElementById("livecode-project-menu");
  const btn = document.getElementById("ide-activity-recent");
  if (!menu || !btn) return;
  const rect = btn.getBoundingClientRect();
  const gap = 4;
  const viewportPad = 8;
  menu.style.top = Math.max(viewportPad, rect.bottom + gap) + "px";
  menu.style.right = Math.max(viewportPad, window.innerWidth - rect.right) + "px";
  menu.style.left = "auto";
  const maxH = Math.min(420, window.innerHeight - rect.bottom - gap - viewportPad);
  menu.style.maxHeight = Math.max(160, maxH) + "px";
}

function _livecodeOnProjectMenuReposition() {
  if (!_livecodeProjectMenuOpen) return;
  _livecodePositionProjectMenu();
}

function _livecodeBindProjectMenuReposition() {
  if (_livecodeProjectMenuPositionBound) return;
  _livecodeProjectMenuPositionBound = true;
  window.addEventListener("resize", _livecodeOnProjectMenuReposition, true);
  document.addEventListener("scroll", _livecodeOnProjectMenuReposition, true);
}

function _livecodeUnbindProjectMenuReposition() {
  if (!_livecodeProjectMenuPositionBound) return;
  _livecodeProjectMenuPositionBound = false;
  window.removeEventListener("resize", _livecodeOnProjectMenuReposition, true);
  document.removeEventListener("scroll", _livecodeOnProjectMenuReposition, true);
}

function renderLiveCodeProjectDropdown() {
  const list = document.getElementById("livecode-project-menu-list");
  if (!list) return;
  _livecodeCloseSessionItemMenus();
  list.innerHTML = "";
  const projects = getLiveCodeRecentProjects();
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "livecode-chat-session-menu-empty";
    empty.textContent = "No recent projects";
    list.appendChild(empty);
  } else {
    const label = document.createElement("div");
    label.className = "livecode-chat-session-menu-section-label";
    label.textContent = "Recent";
    list.appendChild(label);
    projects.forEach(function(path) {
      list.appendChild(_livecodeCreateProjectMenuRow(path));
    });
  }
  const sep = document.createElement("div");
  sep.className = "livecode-project-menu-sep";
  list.appendChild(sep);
  const openRow = document.createElement("div");
  openRow.className = "livecode-chat-session-menu-item-row theme-transition";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "livecode-chat-session-menu-item theme-transition";
  openBtn.onclick = function() {
    window.openLiveCodeFolderFromMenu();
  };
  const openTitle = document.createElement("span");
  openTitle.className = "livecode-chat-session-menu-item-title";
  openTitle.textContent = "Open Folder…";
  openBtn.appendChild(openTitle);
  openRow.appendChild(openBtn);
  list.appendChild(openRow);
}

function _livecodeBuildProjectMoreMenu(path) {
  const menu = document.createElement("div");
  menu.className = "chat-history-menu livecode-chat-session-item-menu";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "chat-history-menu-item danger";
  removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9,3H7c0-1.7,1.3-3,3-3v2C9.4,2,9,2.4,9,3z"/><path d="M17,3h-2c0-0.6-0.4-1-1-1V0C15.7,0,17,1.3,17,3z"/><polygon points="17,6 7,6 7,3 9,3 9,4 15,4 15,3 17,3"/><rect x="10" width="4" height="2"/><path d="M21,6H3C2.4,6,2,5.6,2,5s0.4-1,1-1h18c0.6,0,1,0.4,1,1S21.6,6,21,6z"/><path d="M19,24H5c-0.6,0-1-0.4-1-1V9c0-0.6,0.4-1,1-1h14c0.6,0,1,0.4,1,1v14C20,23.6,19.6,24,19,24z M6,22h12V10H6V22z"/><path d="M10,20c-0.6,0-1-0.4-1-1v-6c0-0.6,0.4-1,1-1s1,0.4,1,1v6C11,19.6,10.6,20,10,20z"/><path d="M14,20c-0.6,0-1-0.4-1-1v-6c0-0.6,0.4-1,1-1s1,0.4,1,1v6C15,19.6,14.6,20,14,20z"/></svg>Remove from recents';
  removeBtn.onclick = function(ev) {
    ev.stopPropagation();
    _livecodeCloseSessionItemMenus();
    removeLiveCodeRecentProject(path);
  };
  menu.appendChild(removeBtn);
  return menu;
}

function _livecodeCreateProjectMenuRow(path) {
  const name = path.split("/").filter(Boolean).pop() || path;
  const isActive = path === livecodeProjectPath;

  const row = document.createElement("div");
  row.className = "livecode-chat-session-menu-item-row theme-transition";
  row.dataset.projectPath = path;

  const itemBtn = document.createElement("button");
  itemBtn.type = "button";
  itemBtn.className = "livecode-chat-session-menu-item theme-transition" + (isActive ? " is-active" : "");
  const titleSpan = document.createElement("span");
  titleSpan.className = "livecode-chat-session-menu-item-title";
  titleSpan.title = path;
  titleSpan.textContent = name;
  itemBtn.appendChild(titleSpan);
  itemBtn.onclick = function(e) {
    if (e.target.closest(".chat-history-menu") || e.target.closest(".livecode-chat-session-menu-item-more")) {
      return;
    }
    _livecodeCloseSessionItemMenus();
    window.selectLiveCodeProjectFromMenu(path);
  };

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "livecode-chat-session-menu-item-more chat-history-item-more";
  moreBtn.title = "More";
  moreBtn.setAttribute("aria-label", "More options");
  moreBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>';
  moreBtn.onclick = function(e) {
    e.stopPropagation();
    _livecodeToggleSessionItemMenu(moreBtn, function() {
      return _livecodeBuildProjectMoreMenu(path);
    });
  };

  row.appendChild(itemBtn);
  row.appendChild(moreBtn);
  return row;
}

window.selectLiveCodeProjectFromMenu = function(path) {
  closeLiveCodeProjectMenu();
  if (!path) return;
  setLiveCodeProject(path);
  showIDEPanel("explorer");
};

window.openLiveCodeFolderFromMenu = function() {
  closeLiveCodeProjectMenu();
  openLiveCodeProjectBrowser();
};

window.closeLiveCodeProjectMenu = function() {
  const menu = document.getElementById("livecode-project-menu");
  const btn = document.getElementById("ide-activity-recent");
  if (menu) menu.style.display = "none";
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  }
  _livecodeProjectMenuOpen = false;
  _livecodeUnbindProjectMenuReposition();
  _livecodeCloseSessionItemMenus();
};

window.toggleLiveCodeProjectMenu = function() {
  const menu = document.getElementById("livecode-project-menu");
  const btn = document.getElementById("ide-activity-recent");
  if (!menu || !btn) return;
  if (_livecodeProjectMenuOpen) {
    closeLiveCodeProjectMenu();
    return;
  }
  if (typeof closeLiveCodeSessionMenu === "function") closeLiveCodeSessionMenu();
  _livecodeEnsureProjectMenuPortal();
  _livecodeProjectMenuOpen = true;
  _livecodePositionProjectMenu();
  menu.style.display = "flex";
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("active");
  btn.setAttribute("aria-pressed", "true");
  renderLiveCodeProjectDropdown();
  _livecodeBindProjectMenuReposition();
};

function _livecodeRefreshSessionMenuIfOpen() {
  if (!_livecodeSessionMenuOpen) return;
  renderLiveCodeSessionDropdown();
  _livecodePositionSessionMenu();
}

function renderLiveCodeRecentSessions() {
  _livecodeRefreshSessionMenuIfOpen();
}

function _livecodeRenderSessionMessages(messages, out) {
  if (!out) return { firstUser: "" };
  _livecodeResetTurnState();
  let firstUser = "";
  (messages || []).forEach(function(msg) {
    const role = msg.role;
    if (role === "diff") {
      appendLiveCodeDiffBlock({
        file_name: msg.file_name,
        diff_html: msg.diff_html,
        additions: msg.additions || 0,
        deletions: msg.deletions || 0,
        absolute_path: msg.absolute_path || "",
      }, out);
      return;
    }
    if (role === "tool_artifact") {
      _livecodeAppendLoadedToolArtifact(msg, out);
      return;
    }
    if (role === "tool") {
      const text = String(msg.content || "");
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        if (parsed && (parsed.command || parsed.output !== undefined)) {
          _livecodeAppendLoadedCommandBlock(
            parsed.command || "",
            parsed.output || parsed.error || "",
            parsed.exit_code,
            out
          );
          return;
        }
      } catch (_) {}
      return;
    }
    const text = String(msg.content || "");
    const hasDisplay = msg.display && (
      msg.display.text || msg.display.segments || msg.display.images
    );
    if (!text && !hasDisplay && role !== "activity") return;
    if (role === "user") {
      var displayPayload = msg.display || null;
      var displayText = (displayPayload && displayPayload.text)
        ? String(displayPayload.text)
        : _livecodeStripAttachedFileBlocks(text);
      if (displayPayload && !displayPayload.text && displayText) {
        displayPayload = Object.assign({}, displayPayload, { text: displayText });
      } else if (!displayPayload && displayText) {
        displayPayload = { text: displayText, segments: [], attachments: [] };
      }
      firstUser = firstUser || displayText || text;
      let urow = null;
      if (displayPayload && typeof window.renderLivecodeUserMessage === "function") {
        urow = window.renderLivecodeUserMessage(out, displayPayload);
      }
      if (!urow && displayText) {
        urow = document.createElement("div");
        urow.className = "chat-row livecode-user-row";
        urow.innerHTML = `<div class="chat-msg user"><span class="livecode-user-text">${_livecodeEscapeHtml(displayText)}</span></div>`;
        out.appendChild(urow);
      }
      _livecodeCurrentUserRow = urow;
      _livecodeScheduleUserMessageCollapseState(out);
    } else if (role === "assistant") {
      const arow = document.createElement("div");
      arow.className = "chat-row livecode-assistant-row";
      const msgEl = document.createElement("div");
      msgEl.className = "chat-msg assistant livecode-stream-msg livecode-plain-msg";
      arow.appendChild(msgEl);
      out.appendChild(arow);
      _livecodeRenderAssistantMarkdown(msgEl, text);
    } else if (role === "activity") {
      if (msg.thought_only) {
        const thought = String(msg.thought_content || msg.content || "").trim();
        if (thought) {
          const wrap = _livecodeAppendActivityParts({
            verb: "thought",
            detail: (msg.duration_s ? msg.duration_s + "s" : "0s"),
            meta: "",
            thoughtContent: thought,
          }, false, out);
          if (wrap) {
            const contentEl = wrap.querySelector(".livecode-thought-content");
            if (contentEl) _livecodeRenderThoughtMarkdown(contentEl, thought);
          }
        }
      } else if (msg.tool_calls && msg.tool_calls.length) {
        _livecodeAppendLoadedToolActivity(msg, out);
      } else if (text) {
        _livecodeAppendLoadedActivitySummary(text, out);
      }
    }
  });
  _livecodeSyncTurnPointersFromDom();
  return { firstUser: firstUser };
}

async function _livecodeFetchSessionIntoTab(tab, sessionId, options) {
  options = options || {};
  if (!tab || !sessionId || !livecodeProjectPath) return;
  _livecodeClearTabUnread(tab);
  tab.sessionId = sessionId;
  if (tab.id === livecodeActiveChatTabId) {
    livecodeAgentSessionId = sessionId;
  }

  if (!options.forceServer && tab.agentRunning && tab.messagesHtml && tab.chatStarted) {
    _livecodeSaveSessionForProject(livecodeProjectPath, sessionId);
    _livecodeChatStarted = true;
    _livecodeShowChatContainer();
    _livecodeLoadChatTabState(tab);
    _livecodePostProcessRestoredOutput(getLiveCodeChatOutput());
    _livecodeRenderChatTabs();
    toggleLiveCodeAgentPane(true);
    return;
  }

  if (!options.forceServer && tab.agentRunning) {
    const snap = _livecodeLoadChatSnapshot(livecodeProjectPath, sessionId);
    if (_livecodeApplySnapshotToTab(tab, sessionId, snap)) {
      toggleLiveCodeAgentPane(true);
      return;
    }
  }

  const silent = !!options.silent;
  const hadCachedContent = !!(tab.messagesHtml && String(tab.messagesHtml).trim());
  const wasActiveAtStart = tab.id === livecodeActiveChatTabId;

  if (!silent) {
    tab.title = "Loading…";
    if (wasActiveAtStart) {
      _livecodeLoadChatTabState(tab);
      toggleLiveCodeAgentPane(true);
      _livecodeShowChatContainer();
      const liveOut = getLiveCodeChatOutput();
      _livecodeMarkChatOutputForTab(liveOut, tab);
      if (liveOut) {
        if (hadCachedContent) {
          liveOut.innerHTML = tab.messagesHtml;
          _livecodePostProcessRestoredOutput(liveOut);
        } else {
          liveOut.innerHTML = '<div class="chat-row"><div class="chat-msg assistant livecode-plain-msg" style="opacity:0.7;font-size:13px;">Loading session…</div></div>';
        }
      }
    }
    _livecodeRenderChatTabs();
  }
  try {
    const resp = await fetch(
      "/livecode/session?project_path=" + encodeURIComponent(livecodeProjectPath) +
      "&session_id=" + encodeURIComponent(sessionId)
    );
    const data = await resp.json();
    const messages = data && data.success ? (data.messages || []) : [];
    if (!messages.length) {

      if (silent) return;
      if (tab.id === livecodeActiveChatTabId) {
        _livecodeResetTabToNewChat(tab);
      } else {
        tab.title = "New chat";
        tab.messagesHtml = "";
        tab.chatStarted = false;
        tab.sessionId = _livecodeNewChatSessionId();
        tab.hasUnread = false;
        _livecodeRenderChatTabs();
      }
      return;
    }
    const isStillActive = tab.id === livecodeActiveChatTabId;

    const renderOut = (isStillActive && !silent) ? getLiveCodeChatOutput() : document.createElement("div");
    if (!renderOut) return;
    renderOut.innerHTML = "";
    const rendered = _livecodeRenderSessionMessages(messages, renderOut);
    _livecodeStripStaleWelcome(renderOut);
    _livecodeSanitizeLoadedActivityHtml(renderOut);
    _livecodePostProcessRestoredOutput(renderOut);
    const newHtml = renderOut.innerHTML;
    const changed = newHtml !== tab.messagesHtml;
    tab.messagesHtml = newHtml;
    tab.chatStarted = true;
    tab.restoredFromServer = true;
    if (isStillActive) {
      livecodeAgentSessionId = tab.sessionId;
      _livecodeChatStarted = true;
      _livecodeShowChatContainer();
      if (silent && changed) {
        const liveOut = getLiveCodeChatOutput();
        if (liveOut) {
          liveOut.innerHTML = newHtml;
          _livecodePostProcessRestoredOutput(liveOut);
        }
      }
    }
    tab.title = _livecodeTruncateTabTitle(
      (data.summary && data.summary.title) || rendered.firstUser || "Chat"
    );
    _livecodeSaveSessionForProject(livecodeProjectPath, sessionId);
    _livecodePersistChatSnapshot(livecodeProjectPath, tab);
    if (!silent) _livecodeRenderChatTabs();
    renderLiveCodeRecentSessions();
    if (isStillActive && !silent) renderOut.scrollTop = renderOut.scrollHeight;
  } catch (e) {
    if (silent) {
      console.error("LiveCode: background session refresh failed", e);
      return;
    }
    if (tab.id === livecodeActiveChatTabId) {
      _livecodeResetTabToNewChat(tab);
    }
  }
}

window.resumeLiveCodeSession = async function(sessionId) {
  if (!sessionId || !livecodeProjectPath) return;
  closeLiveCodeSessionMenu();
  let tab = livecodeChatTabs.find(function(t) { return t.sessionId === sessionId; });
  if (tab) {
    if (tab.id !== livecodeActiveChatTabId) {
      _livecodeSwitchChatTab(tab.id);
    } else {
      _livecodeClearTabUnread(tab);
    }
  } else {
    _livecodeSaveActiveChatTabState();
    let activeTab = _livecodeGetActiveChatTab();
    if (!activeTab) {
      _livecodeInitChatTabs();
      activeTab = _livecodeGetActiveChatTab();
    }
    if (activeTab && activeTab.chatStarted) {
      _livecodeCreateChatTab("Loading…", { activate: true });
      tab = _livecodeGetActiveChatTab();
    } else {
      tab = activeTab;
    }
  }
  if (!tab) return;
  const fetchOpts = tab.agentRunning ? {} : { forceServer: true };
  await _livecodeFetchSessionIntoTab(tab, sessionId, fetchOpts);
};

const LIVECODE_PROJECT_TAB = "__livecode_project__";

window.inferLangFromPath = function(path) {
  const p = (path || "").toLowerCase();
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".js")) return "javascript";
  if (p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".go")) return "golang";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".xml")) return "xml";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".sql")) return "sql";
  if (p.endsWith(".sh") || p.endsWith(".bash")) return "sh";
  if (p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".yml")) return "yml";
  if (p.endsWith(".toml")) return "toml";
  if (p.endsWith(".ini")) return "ini";
  if (p.endsWith(".properties")) return "ini";
  if (p.endsWith(".dockerfile")) return "text";
  if (p.endsWith(".txt")) return "text";
  return "text";
};

window.mapToMonacoLang = function(lang) {
  const langMap = {
    python: "python",
    html: "html",
    javascript: "javascript",
    typescript: "typescript",
    json: "json",
    golang: "go",
    markdown: "markdown",
    text: "plaintext",
    xml: "xml",
    css: "css",
    sql: "sql",
    sh: "shell",
    yaml: "yaml",
    yml: "yaml",
    toml: "plaintext",
    ini: "plaintext"
  };
  return langMap[lang] || "plaintext";
};

window.applyIDEDynamicTheme = function(themeName) {
  if (!window.monaco) return;
  const isPink = themeName === "pink";
  const isDark = themeName === "dark";
  const isBlack = themeName === "black";
  const bg = isPink ? "#fdf2f8" : isBlack ? "#1a1a1a" : isDark ? "#1e293b" : themeName === "white" ? "#f1f5f9" : "#ffffff";
  const fg = isPink ? "#831843" : isBlack ? "#d4d4d4" : isDark ? "#e2e8f0" : "#1e293b";
  const themeId = "livecode-dynamic-theme";
  monaco.editor.defineTheme(themeId, {
    base: isDark || isBlack ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editorGutter.background": bg,
      "editorLineNumber.foreground": isPink ? "#be185d" : isBlack ? "#737373" : isDark ? "#94a3b8" : "#64748b",
      "editorLineNumber.activeForeground": isPink ? "#831843" : isBlack || isDark ? "#ffffff" : "#111827",
      "editor.lineHighlightBackground": bg,
      "editor.selectionBackground": isPink ? "#fbcfe8" : isBlack ? "#1f2937" : isDark ? "#334155" : "#cfe8ff",
      "editorIndentGuide.background": isPink ? "#f9a8d4" : isBlack ? "#1a1a1a" : isDark ? "#334155" : "#e5e7eb",
      "editorIndentGuide.activeBackground": isPink ? "#ec4899" : isBlack ? "#404040" : isDark ? "#64748b" : "#9ca3af"
    }
  });
  monaco.editor.setTheme(themeId);
  return themeId;
};

function initializeIDEEditor() {
  if (window.ideEditor) return;
  const container = document.getElementById("ide-monaco");
  if (!container) return;
  const wasHidden = container.style.display === "none";
  try {
    container.style.display = "block";
  } catch (_) {}
  function createEditor() {
    const currentTheme = localStorage.getItem("livecode-theme") || "dark";
    if (window.monaco && window.applyIDEDynamicTheme) {
      window.applyIDEDynamicTheme(currentTheme);
    }
    console.log("Creating Monaco editor for IDE section...");
    window.ideEditor = monaco.editor.create(container, {
      value: "",
      language: "plaintext",
      theme: "livecode-dynamic-theme",
      automaticLayout: true,
      minimap: {
        enabled: false
      },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      fontLigatures: false,
      fontWeight: "400",
      fontFamily: window.LIVECODE_MONACO_FONT,
      tabSize: 4,
      insertSpaces: true,
      renderWhitespace: "boundary",
      cursorBlinking: "solid",
      cursorStyle: "line",
      smoothScrolling: true,
      roundedSelection: false,
      renderLineHighlight: "gutter",
      lineDecorationsWidth: 16,
      glyphMargin: true,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: "always",
      scrollbar: {
        horizontal: "auto",
        vertical: "auto",
        horizontalScrollbarSize: 10,
        verticalScrollbarSize: 10,
        horizontalSliderSize: 10,
        verticalSliderSize: 10,
        useShadows: false,
        handleMouseWheel: true
      }
    });
    try {
      monaco.editor.remeasureFonts();
    } catch (e) {}
    window.addEventListener("resize", function() {
      if (window.ideEditor) {
        try {
          window.ideEditor.layout();
        } catch (_) {}
      }
    });
    ideEditor = window.ideEditor;
    window.ideEditorReady = true;
    _livecodeBindEditorAutosaveOnce();
    _livecodeBindPlanMonacoAutosave();
    console.log("Monaco editor created successfully for IDE section");
    if (wasHidden || !ideActiveFile) {
      container.style.display = "none";
      const placeholder = document.getElementById("ide-editor-placeholder");
      if (placeholder) {
        updateLiveCodeEditorPlaceholder();
        placeholder.style.display = "flex";
      }
    }
  }
  if (typeof require !== "undefined") {
    require.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs"
      }
    });
    if (window.monaco && monaco.editor) {
      if (typeof window.installLivecodeMonacoDefaults === "function") {
        window.installLivecodeMonacoDefaults();
      }
      createEditor();
    } else {
      require([ "vs/editor/editor.main" ], function() {
        if (typeof window.installLivecodeMonacoDefaults === "function") {
          window.installLivecodeMonacoDefaults();
        }
        createEditor();
      });
    }
  }
}

window.createAndShowIDEEditor = function(showImmediately = true) {
  var ideSection = document.getElementById("ide-editor-section");
  var ideBtn = document.getElementById("ideEditorToggleBtn");
  if (!ideSection) return false;
  if (ideSection.style.display === "none" || !ideSection.style.display) {
    closeAllSectionsExcept("ideEditor");
    ideSection.style.display = "block";
    if (typeof updateDockIndicators === "function") {
      updateDockIndicators("ideEditor");
    }
    if (window.ideIsFullscreen) {
      exitIDEFullscreen();
    }
    initializeIDEEditor();
    const panelContent = document.getElementById("ide-panel-content");
    if (panelContent) {
      panelContent.style.overflowX = "auto";
      panelContent.style.overflowY = "auto";
    }
    setTimeout(function() {
      initLiveCodeProjectState();
      if (!ideTerminalInitialized) {
        initializeIDETerminal();
      }
      if (typeof window.initChatbotModelSelectors === "function") {
        window.initChatbotModelSelectors();
      }
      if (typeof window.initLivecodeModeSelector === "function") {
        window.initLivecodeModeSelector();
      }
      if (typeof window.refreshLivecodeShimmerStyle === "function") {
        window.refreshLivecodeShimmerStyle();
      }
    }, 100);
    if (showImmediately && ideSection) {}
  } else {
    window.livecodeRecordToolOpen("ideEditor");
    return false;
  }
  return true;
};

window.closeIDEEditor = function() {
  var ideSection = document.getElementById("ide-editor-section");
  var ideBtn = document.getElementById("ideEditorToggleBtn");
  if (ideSection) {
    if (window.ideIsFullscreen) {
      exitIDEFullscreen();
    }
    ideSection.style.display = "none";
    if (ideBtn) ideBtn.classList.remove("selected");
    var openSections = parseLivecodeOpenSectionsList();
    openSections = openSections.filter(s => s !== "ideEditor");
    if (typeof saveOpenSections === "function") {
      saveOpenSections(openSections);
    } else {
      localStorage.setItem("livecode-open-sections", JSON.stringify(openSections));
    }
  }
  closeAllSectionsExcept(null);
  updateNotesVisibility();
};

window.toggleIDEFullscreen = function() {
  if (window.ideIsFullscreen) {
    exitIDEFullscreen();
  } else {
    enterIDEFullscreen();
  }
};

function _livecodeRelayoutAfterFullscreen() {
  setTimeout(function() {
    if (window.ideEditor) {
      try { window.ideEditor.layout(); } catch (e) {}
    }
    if (ideFitAddon) {
      try { ideFitAddon.fit(); } catch (e) {}
    }
  }, 100);
}

function enterIDEFullscreen() {
  const ideSection = document.getElementById("ide-editor-section");
  const ideInner = document.getElementById("ide-editor-inner");
  if (!ideSection || !ideInner) return;
  if (!window.ideOriginalStates) window.ideOriginalStates = {};
  window.ideOriginalStates["ideInnerHeight"] = ideInner.style.height || "";
  ideSection.classList.add("fullscreen-section");
  document.body.classList.add("ide-editor-fullscreen");
  document.documentElement.classList.add("ide-editor-fullscreen");
  ideInner.style.height = "100%";
  const enterIcon = document.getElementById("ide-fullscreen-enter-icon");
  const exitIcon = document.getElementById("ide-fullscreen-exit-icon");
  if (enterIcon) enterIcon.style.display = "none";
  if (exitIcon) exitIcon.style.display = "block";
  window.ideIsFullscreen = true;
  _livecodeRelayoutAfterFullscreen();
}

function exitIDEFullscreen() {
  const ideSection = document.getElementById("ide-editor-section");
  const ideInner = document.getElementById("ide-editor-inner");
  if (!ideSection || !ideInner) return;
  ideSection.classList.remove("fullscreen-section");
  document.body.classList.remove("ide-editor-fullscreen");
  document.documentElement.classList.remove("ide-editor-fullscreen");
  const originalHeight = (window.ideOriginalStates && window.ideOriginalStates["ideInnerHeight"]) || "";
  ideInner.style.height = originalHeight || "";
  const enterIcon = document.getElementById("ide-fullscreen-enter-icon");
  const exitIcon = document.getElementById("ide-fullscreen-exit-icon");
  if (enterIcon) enterIcon.style.display = "block";
  if (exitIcon) exitIcon.style.display = "none";
  window.ideIsFullscreen = false;
  _livecodeRelayoutAfterFullscreen();
}

let ideTerminalTabs = [];

let ideActiveTabId = null;

let ideTerminalTabCounter = 0;

function _livecodeWaitForNonZeroSize(el, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    function tick() {
      if (!el || !el.isConnected) {
        resolve(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      const ok = rect && rect.width > 2 && rect.height > 2;
      if (ok) {
        resolve(true);
        return;
      }
      if (performance.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function _livecodeTerminalWrite(terminal, payload) {
  if (!terminal || !payload) return;
  if (payload.data) {
    try {
      const raw = atob(payload.data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      terminal.write(bytes);
      return;
    } catch (e) {}
  }
  if (payload.output != null) {
    try {
      terminal.write(payload.output);
    } catch (e) {}
  }
}

function _livecodeFlushTerminalOutput(tabData) {
  if (!tabData) return;
  if (!tabData._pendingOutput || !tabData.terminal) return;
  try {
    tabData.terminal.write(tabData._pendingOutput);
  } catch (e) {}
  tabData._pendingOutput = "";
}

function _livecodeFocusTerminalTab(tabData) {
  if (!tabData || !tabData.terminal) return;
  try {
    if (window.ideEditor && typeof window.ideEditor.focus === "function") {
      const editorDom = document.getElementById("ide-editor-container");
      if (editorDom && editorDom.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }
    tabData.terminal.focus();
  } catch (e) {}
}

function _livecodeBindTerminalFocus(tabData, terminal, terminalWrapper) {
  if (!tabData || !terminal || !terminalWrapper || tabData._focusBound) return;
  tabData._focusBound = true;
  const focusTerminal = function(e) {
    if (e) e.stopPropagation();
    _livecodeFocusTerminalTab(tabData);
  };
  terminalWrapper.addEventListener("mousedown", focusTerminal);
  terminalWrapper.addEventListener("click", focusTerminal);
}

function _livecodeFitTerminalTab(tabData, { emitResize = false } = {}) {
  if (!tabData) return;
  const wrapper = document.getElementById(`ide-terminal-wrapper-${tabData.id}`);
  if (!wrapper) return;

  const applyViewportPadding = () => {
    const viewport = wrapper.querySelector(".xterm-viewport");
    if (viewport) {
      viewport.style.position = "absolute";
      viewport.style.top = "0";
      viewport.style.left = "0";
      viewport.style.right = "0";
      viewport.style.bottom = "0";
    }
  };

  applyViewportPadding();

  if (tabData.fitAddon) {
    try {
      tabData.fitAddon.fit();
    } catch (e) {}
  }

  if (tabData.terminal) {
    try {
      tabData.terminal.scrollToBottom();
    } catch (e) {}
  }

  if (emitResize && tabData.socket && tabData.fitAddon) {
    try {
      const dims = tabData.fitAddon.proposeDimensions();
      if (dims) {
        tabData.socket.emit("terminal_resize", {
          terminal_id: tabData.id,
          cols: dims.cols,
          rows: dims.rows
        });
      }
    } catch (e) {}
  }
}

function createTerminalTab(name = null) {
  const tabId = `terminal-${++ideTerminalTabCounter}`;
  let tabName = name;
  if (!tabName) {
    if (ideTerminalTabCounter === 1) {
      tabName = "Terminal";
    } else {
      tabName = `Local (${ideTerminalTabCounter - 1})`;
    }
  }
  const tabsList = document.getElementById("ide-terminal-tabs-list");
  if (!tabsList) return null;
  const tabElement = document.createElement("button");
  tabElement.className = "ide-terminal-tab";
  tabElement.id = `ide-terminal-tab-${tabId}`;
  tabElement.dataset.tabId = tabId;
  const label = document.createElement("span");
  label.className = "ide-terminal-tab-label";
  label.textContent = tabName;
  const closeBtn = document.createElement("button");
  closeBtn.className = "ide-terminal-tab-close";
  closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  closeBtn.onclick = e => {
    e.stopPropagation();
    closeTerminalTab(tabId);
  };
  tabElement.appendChild(label);
  tabElement.appendChild(closeBtn);
  tabElement.onclick = () => switchTerminalTab(tabId);
  tabsList.appendChild(tabElement);
  const tabData = {
    id: tabId,
    name: tabName,
    element: tabElement,
    terminal: null,
    fitAddon: null,
    socket: null,
    initialized: false,
    termReady: false,
    _initSent: false,
    _pendingOutput: ""
  };
  ideTerminalTabs.push(tabData);
  switchTerminalTab(tabId);
  return tabId;
}

function switchTerminalTab(tabId) {
  if (ideActiveTabId === tabId) return;
  const tabData = ideTerminalTabs.find(t => t.id === tabId);
  if (!tabData) return;
  const container = document.getElementById("ide-terminal-container");
  if (!container) return;
  const allWrappers = container.querySelectorAll('[id^="ide-terminal-wrapper-"]');
  allWrappers.forEach(wrapper => {
    wrapper.style.display = "none";
  });
  ideTerminalTabs.forEach(tab => {
    const tabElement = document.querySelector(`#ide-terminal-tab-${tab.id}`);
    if (tabElement) {
      tabElement.classList.remove("active");
    }
  });
  ideActiveTabId = tabId;
  const tabElement = document.querySelector(`#ide-terminal-tab-${tabId}`);
  if (tabElement) {
    tabElement.classList.add("active");
  }
  if (!tabData.initialized) {
    initializeTerminalForTab(tabData, container);
  } else {
    const wrapper = document.getElementById(`ide-terminal-wrapper-${tabId}`);
    if (wrapper) {
      wrapper.style.display = "block";
      _livecodeWaitForNonZeroSize(wrapper, { timeoutMs: 1000 }).finally(() => {
        _livecodeFitTerminalTab(tabData, { emitResize: true });
        _livecodeFlushTerminalOutput(tabData);
        if (tabData.terminal) {
          _livecodeFocusTerminalTab(tabData);
        }
        ideTerminal = tabData.terminal;
        ideFitAddon = tabData.fitAddon;
        window.ideTerminalSocket = tabData.socket;
      });
    }
  }
}

function _livecodeTeardownTerminalTab(tabData) {
  if (!tabData) return;
  if (tabData._terminalResizeObserver) {
    try {
      tabData._terminalResizeObserver.disconnect();
    } catch (e) {}
    tabData._terminalResizeObserver = null;
  }
  if (tabData._windowResizeHandler) {
    window.removeEventListener("resize", tabData._windowResizeHandler);
    tabData._windowResizeHandler = null;
  }
  if (tabData.socket) {
    try {
      tabData.socket.emit("terminal_close", { terminal_id: tabData.id });
      tabData.socket.disconnect();
    } catch (e) {}
    tabData.socket = null;
  }
  if (tabData.terminal) {
    try {
      tabData.terminal.dispose();
    } catch (e) {}
    tabData.terminal = null;
  }
  const wrapper = document.getElementById(`ide-terminal-wrapper-${tabData.id}`);
  if (wrapper && wrapper.parentNode) {
    wrapper.parentNode.removeChild(wrapper);
  }
  if (tabData.element && tabData.element.parentNode) {
    tabData.element.parentNode.removeChild(tabData.element);
  }
}

function _livecodeResetTerminalsForProject() {
  ideTerminalTabs.slice().forEach(_livecodeTeardownTerminalTab);
  ideTerminalTabs = [];
  ideActiveTabId = null;
  ideTerminalTabCounter = 0;
  ideTerminal = null;
  ideFitAddon = null;
  window.ideTerminalSocket = null;
  ideTerminalInitialized = false;
}

function closeTerminalTab(tabId) {
  const tabIndex = ideTerminalTabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;
  const tabData = ideTerminalTabs[tabIndex];
  const isLastTab = ideTerminalTabs.length === 1;
  _livecodeTeardownTerminalTab(tabData);
  ideTerminalTabs.splice(tabIndex, 1);
  if (isLastTab) {
    ideActiveTabId = null;
    hideIDETerminal();
    return;
  }
  if (ideActiveTabId === tabId) {
    if (ideTerminalTabs.length > 0) {
      switchTerminalTab(ideTerminalTabs[ideTerminalTabs.length - 1].id);
    } else {
      ideActiveTabId = null;
    }
  }
}

function _livecodeGetTerminalTheme() {

  const styles = getComputedStyle(document.body);
  const read = (name, fallback) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };

  const bg = read("--ide-terminal-bg", "#141414");
  const fg = read("--ide-terminal-fg", "#ffffff");
  const selectionBackground = read("--ide-terminal-selection-bg", "rgba(148, 163, 184, 0.35)");
  const selectionForeground = read("--ide-terminal-selection-fg", fg);

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,

    selection: selectionBackground,
    selectionBackground: selectionBackground,
    selectionForeground: selectionForeground
  };
}

function _livecodeApplyTerminalTheme() {
  const theme = _livecodeGetTerminalTheme();
  ideTerminalTabs.forEach((t) => {
    if (!t || !t.terminal) return;
    try {
      t.terminal.options.theme = theme;
    } catch (e) {}
  });
}
window._livecodeApplyTerminalTheme = _livecodeApplyTerminalTheme;

function initializeTerminalForTab(tabData, container) {

  const fontStack = "'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', monospace";

  const terminalWrapper = document.createElement("div");
  terminalWrapper.id = `ide-terminal-wrapper-${tabData.id}`;
  terminalWrapper.style.cssText = "width:100%;height:100%;position:relative;";
  terminalWrapper.style.padding = "0";
  terminalWrapper.style.boxSizing = "border-box";
  container.appendChild(terminalWrapper);

  const isActive = () => ideActiveTabId === tabData.id;

  document.fonts.ready.then(() => {
    Promise.resolve().finally(() => {

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: fontStack,
        fontSize: 13,
        lineHeight: 1.2,
        fontWeight: "normal",
        letterSpacing: 0,
        theme: _livecodeGetTerminalTheme(),
        allowProposedApi: true,
        rightClickSelectsWord: true
      });

      let fitAddon = null;
      if (window.FitAddon) {
        fitAddon = new window.FitAddon.FitAddon;
        terminal.loadAddon(fitAddon);
      }

      terminal.open(terminalWrapper);

      const socket = io.connect(location.protocol + "//" + location.host);
      socket.on("connect_error", function() {
        try {
          socket.disconnect();
        } catch (e) {}
      });

      function emitInitWithBestDims() {
        let cols = 80;
        let rows = 24;
        if (fitAddon) {
          try {
            const dims = fitAddon.proposeDimensions();
            if (dims && dims.cols && dims.rows) {
              cols = dims.cols;
              rows = dims.rows;
            }
          } catch (e) {}
        }
        socket.emit("terminal_init", {
          terminal_id: tabData.id,
          cols,
          rows,
          cwd: livecodeProjectPath || undefined
        });
      }

      function ensureFitAndInit() {
        return _livecodeWaitForNonZeroSize(terminalWrapper, { timeoutMs: 2000 }).finally(() => {
          _livecodeFitTerminalTab(tabData);
          if (socket && socket.connected && !tabData._initSent) {
            tabData._initSent = true;
            emitInitWithBestDims();
          }
          if (isActive()) {
            _livecodeFlushTerminalOutput(tabData);
            _livecodeFocusTerminalTab(tabData);
          }
        });
      }

      socket.on("connect", () => {
        ensureFitAndInit();
      });

      socket.on("terminal_output", data => {
        if (!data) return;
        if (data.terminal_id && data.terminal_id !== tabData.id) return;
        if (isActive() && ideTerminalVisible) {
          _livecodeTerminalWrite(terminal, data);
          setTimeout(() => {
            try {
              terminal.scrollToBottom();
            } catch (e) {}
          }, 10);
        } else {
          const chunk = data.data
            ? (() => {
                try {
                  return atob(data.data);
                } catch (e) {
                  return "";
                }
              })()
            : (data.output || "");
          tabData._pendingOutput = (tabData._pendingOutput || "") + chunk;
        }
      });

      socket.on("terminal_ready", data => {
        if (!data || (data.terminal_id && data.terminal_id !== tabData.id)) return;
        tabData.termReady = !!data.ok;
        if (data.ok) {
          _livecodeFitTerminalTab(tabData, { emitResize: true });
          _livecodeFlushTerminalOutput(tabData);
          if (isActive()) {
            _livecodeFocusTerminalTab(tabData);
            try {
              terminal.scrollToBottom();
            } catch (e) {}
          }
        } else if (data.error) {
          try {
            terminal.write("\r\n\x1b[31mTerminal unavailable: " + data.error + "\x1b[0m\r\n");
          } catch (e) {}
        }
      });

      terminal.onData(data => {
        if (!tabData.termReady) return;
        socket.emit("terminal_input", {
          terminal_id: tabData.id,
          input: data
        });
      });

      terminal.onResize(size => {
        if (!tabData.termReady) return;
        socket.emit("terminal_resize", {
          terminal_id: tabData.id,
          cols: size.cols,
          rows: size.rows
        });
      });

      tabData.terminal = terminal;
      tabData.fitAddon = fitAddon;
      tabData.socket = socket;
      tabData.initialized = true;
      tabData.terminal.element = terminalWrapper;
      _livecodeBindTerminalFocus(tabData, terminal, terminalWrapper);

      if (isActive()) {
        terminalWrapper.style.display = "block";
        ideTerminal = terminal;
        ideFitAddon = fitAddon;
        window.ideTerminalSocket = socket;
      } else {
        terminalWrapper.style.display = "none";
      }

      const windowResizeHandler = () => {
        if (fitAddon && isActive()) {
          _livecodeFitTerminalTab(tabData, { emitResize: true });
        }
      };
      window.addEventListener("resize", windowResizeHandler);
      tabData._windowResizeHandler = windowResizeHandler;

      if (fitAddon && typeof ResizeObserver !== "undefined") {
        const resizeObserver = new ResizeObserver(() => {
          if (!isActive()) return;
          _livecodeFitTerminalTab(tabData, { emitResize: true });
        });
        resizeObserver.observe(terminalWrapper);
        tabData._terminalResizeObserver = resizeObserver;
      }

      ensureFitAndInit();
    });
  });
}

function initializeIDETerminal() {
  const container = document.getElementById("ide-terminal-container");
  if (!container) return;
  const addBtn = document.getElementById("ide-terminal-tab-add");
  if (addBtn) {
    addBtn.onclick = () => createTerminalTab();
  }
  if (ideTerminalTabs.length === 0 && livecodeProjectPath) {
    createTerminalTab("Terminal");
  }
  ideTerminalInitialized = true;
}

let ideTerminalVisible = false;

function showIDETerminal() {
  const terminalPanel = document.getElementById("ide-terminal-panel");
  const terminalDivider = document.getElementById("ide-terminal-divider");
  if (terminalPanel && terminalDivider) {
    terminalPanel.style.display = "flex";
    terminalPanel.style.opacity = "";
    terminalPanel.style.overflow = "";
    terminalPanel.style.transition = "";
    terminalDivider.style.display = "block";
    const ideEditorInner = document.getElementById("ide-editor-inner");
    if (ideEditorInner) {
      const sectionHeight = ideEditorInner.getBoundingClientRect().height || 499;
      const terminalHeight = Math.round(sectionHeight * .3);
      if (!terminalPanel.style.height || terminalPanel.style.height === "100px" || terminalPanel.style.height === "150px") {
        terminalPanel.style.height = terminalHeight + "px";
      }
    }
    if (ideTerminalTabs.length === 0) {
      createTerminalTab("Terminal");
    }
    ideTerminalVisible = true;
    const toggleBtn = document.getElementById("ide-terminal-toggle");
    if (toggleBtn) {
      toggleBtn.innerHTML = `\n                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                    <polyline points="20 6 9 17 4 12"></polyline>\n                 </svg>\n                 <span>Terminal</span>\n               `;
    }
    const activityTerminalBtn = document.getElementById("ide-activity-terminal");
    if (activityTerminalBtn) {
      activityTerminalBtn.classList.add("active");
      activityTerminalBtn.setAttribute("aria-pressed", "true");
    }
    function scheduleFits() {
      [ 100, 280, 550 ].forEach(delay => {
        setTimeout(() => {
          if (ideFitAddon) {
            try {
              ideFitAddon.fit();
            } catch (e) {}
          }
          const activeTab = ideTerminalTabs.find(function(t) { return t.id === ideActiveTabId; });
          if (activeTab) _livecodeFocusTerminalTab(activeTab);
        }, delay);
      });
    }
    scheduleFits();
  }
}

function hideIDETerminal() {
  const terminalPanel = document.getElementById("ide-terminal-panel");
  const terminalDivider = document.getElementById("ide-terminal-divider");
  if (terminalPanel && terminalDivider) {
    terminalPanel.style.display = "none";
    terminalPanel.style.opacity = "";
    terminalPanel.style.overflow = "";
    terminalPanel.style.transition = "";
    terminalDivider.style.display = "none";
    ideTerminalVisible = false;
    const toggleBtn = document.getElementById("ide-terminal-toggle");
    if (toggleBtn) {
      toggleBtn.innerHTML = `\n                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                    <polyline points="4 17 10 11 4 5"></polyline>\n                    <line x1="12" y1="19" x2="20" y2="19"></line>\n                 </svg>\n                 <span>Terminal</span>\n               `;
    }
    const activityTerminalBtn = document.getElementById("ide-activity-terminal");
    if (activityTerminalBtn) {
      activityTerminalBtn.classList.remove("active");
      activityTerminalBtn.setAttribute("aria-pressed", "false");
    }
  }
}

function toggleIDETerminal() {
  if (ideTerminalVisible) {
    hideIDETerminal();
  } else {
    showIDETerminal();
  }
}
window.toggleIDETerminal = toggleIDETerminal;

document.addEventListener("DOMContentLoaded", function() {
  const toggleBtn = document.getElementById("ide-terminal-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleIDETerminal);
  }
});

function updatePlayButtonVisibility() {
  const playButton = document.getElementById("ide-play-button");
  updateIdePlanChrome();
  if (!playButton) return;
  if (!ideActiveFile || !ideOpenFiles[ideActiveFile]) {
    playButton.style.display = "none";
    return;
  }
  const fileName = ideOpenFiles[ideActiveFile].name;
  if (fileName.toLowerCase().endsWith(".py")) {
    playButton.style.display = "inline-flex";
  } else {
    playButton.style.display = "none";
  }
}

function runCurrentPythonFile() {
  if (!ideActiveFile || !ideOpenFiles[ideActiveFile]) {
    return;
  }
  const fileName = ideOpenFiles[ideActiveFile].name;
  if (!fileName.toLowerCase().endsWith(".py")) {
    return;
  }
  runPythonFile(ideActiveFile);
}

function runPythonFile(filePath) {
  showIDETerminal();
  if (!ideTerminalInitialized) {
    initializeIDETerminal();
    setTimeout(() => {
      executePythonFile(filePath);
    }, 500);
  } else {
    executePythonFile(filePath);
  }
}

function executePythonFile(filePath) {
  const command = `python3 "${filePath}"\n`;
  if (!window.ideTerminalSocket) {
    window.ideTerminalSocket = io.connect(location.protocol + "//" + location.host);
    window.ideTerminalSocket.on("connect", () => {
      window.ideTerminalSocket.emit("terminal_input", {
        terminal_id: ideActiveTabId,
        input: command
      });
      setTimeout(() => {
        if (ideTerminal) {
          ideTerminal.focus();
        }
      }, 100);
    });
  } else {
    window.ideTerminalSocket.emit("terminal_input", {
      terminal_id: ideActiveTabId,
      input: command
    });
    setTimeout(() => {
      if (ideTerminal) {
        ideTerminal.focus();
      }
    }, 100);
  }
}

let ideFileTreeData = {};

let ideHomePath = "~";

let ideShowHiddenFiles = false;

function _livecodeRootFolderName(path) {
  return (path || "").split("/").filter(Boolean).pop() || path || "Project";
}

function _livecodeWrapRootTreeChildren(actualPath, children) {
  const rootName = _livecodeRootFolderName(actualPath);
  ideExpandedFolders.add(actualPath);
  return {
    [rootName]: {
      type: "folder",
      path: actualPath,
      is_dir: true,
      children: children,
      expanded: true,
      loaded: true
    }
  };
}

function loadIDEFileTree(path, parentNode = null) {
  const fileTreeEl = document.getElementById("ide-file-tree");
  if (!fileTreeEl) return;
  if (!path && !livecodeProjectPath) {
    renderLiveCodeExplorerEmpty();
    return;
  }
  const listPath = path || livecodeProjectPath;
  if (!listPath) {
    renderLiveCodeExplorerEmpty();
    return;
  }
  const emptyEl = document.getElementById("ide-explorer-empty");
  if (emptyEl) emptyEl.style.display = "none";
  _livecodeIdeSocketRequest(
    "ide_list_files", { path: listPath },
    "ide_files_list",
    function(data) {
      if (!data) return false;
      const candidate = data.requested_path !== undefined ? data.requested_path : data.path;
      return _livecodeNormalizeProjectKey(candidate) === _livecodeNormalizeProjectKey(listPath);
    }
  ).then(function(result) {
    const data = result.data;
    if (data.error) {
      if (result.error) console.error("LiveCode: failed to list", listPath, data.error);
      if (!parentNode) {
        fileTreeEl.innerHTML = `<div style="padding:4px 8px;color:#ef4444;font-size:12px;">Error: ${data.error}</div>`;
      }
      return;
    }
    const actualPath = data.path || listPath;
    if (!parentNode) {
      ideHomePath = actualPath;
      livecodeProjectPath = actualPath;
      livecodeProjectName = actualPath.split("/").filter(Boolean).pop() || actualPath;
    }
    const children = {};
    if (data.files && Array.isArray(data.files)) {
      data.files.forEach(item => {
        const itemPath = item.path;
        const fileName = item.name;
        children[fileName] = {
          type: item.type || (item.is_dir ? "folder" : "file"),
          path: itemPath,
          is_dir: item.is_dir || false,
          children: item.is_dir ? {} : undefined,
          expanded: false,
          loaded: false
        };
      });
    }
    if (parentNode) {
      parentNode.loaded = true;
      parentNode.children = children;
      renderFileTree(ideFileTreeData, fileTreeEl, ideHomePath);
    } else {
      ideFileTreeData[actualPath] = _livecodeWrapRootTreeChildren(actualPath, children);
      renderFileTree(ideFileTreeData, fileTreeEl, actualPath);
    }
    if (typeof _livecodeTryRefreshFileTreeForPending === "function") {
      _livecodeTryRefreshFileTreeForPending();
    }
  });
}

let _livecodePendingFileTreeRefreshPath = null;

function _livecodeFindFileTreeNodeByPath(targetPath) {
  const target = _livecodeNormalizePath(targetPath);
  if (!target) return null;
  const rootKey = ideHomePath || livecodeProjectPath;
  const rootTree = ideFileTreeData[rootKey];
  if (!rootTree) return null;

  function walk(node) {
    if (_livecodeNormalizePath(node.path) === target) return node;
    const kids = node.children;
    if (!kids) return null;
    const names = Object.keys(kids);
    for (let i = 0; i < names.length; i++) {
      const child = kids[names[i]];
      if (_livecodeNormalizePath(child.path) === target) return child;
      if (child.is_dir || child.type === "folder") {
        const deeper = walk(child);
        if (deeper) return deeper;
      }
    }
    return null;
  }

  const rootNames = Object.keys(rootTree);
  for (let i = 0; i < rootNames.length; i++) {
    const rootNode = rootTree[rootNames[i]];
    if (_livecodeNormalizePath(rootNode.path) === target) return rootNode;
    const found = walk(rootNode);
    if (found) return found;
  }
  return null;
}

function _livecodeInsertFileIntoTree(filePath) {
  const normalized = _livecodeNormalizePath(filePath);
  if (!normalized || normalized.indexOf("/") < 0) return false;
  const parentPath = normalized.substring(0, normalized.lastIndexOf("/"));
  const fileName = _livecodeBasename(normalized);
  const parentNode = _livecodeFindFileTreeNodeByPath(parentPath);
  if (!parentNode) return false;
  if (!parentNode.children) parentNode.children = {};
  parentNode.children[fileName] = {
    type: "file",
    path: normalized,
    is_dir: false,
    expanded: false,
    loaded: true
  };
  parentNode.loaded = true;
  parentNode.expanded = true;
  ideExpandedFolders.add(parentNode.path);
  const fileTreeEl = document.getElementById("ide-file-tree");
  if (fileTreeEl) renderFileTree(ideFileTreeData, fileTreeEl, ideHomePath);
  return true;
}

function _livecodeTryRefreshFileTreeForPending() {
  const filePath = _livecodePendingFileTreeRefreshPath;
  if (!filePath || !livecodeProjectPath) return;

  if (_livecodeInsertFileIntoTree(filePath)) {
    _livecodePendingFileTreeRefreshPath = null;
    return;
  }

  const projectRoot = _livecodeNormalizePath(livecodeProjectPath);
  const parentPath = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/"))
    : projectRoot;
  const parentNode = _livecodeFindFileTreeNodeByPath(parentPath);
  if (parentNode) {
    ideExpandedFolders.add(parentNode.path);
    parentNode.expanded = true;
    loadIDEFileTree(parentNode.path, parentNode);
    return;
  }

  const rootNode = _livecodeFindFileTreeNodeByPath(projectRoot);
  if (!rootNode) {
    loadIDEFileTree(livecodeProjectPath);
    return;
  }

  if (!parentPath.startsWith(projectRoot)) {
    _livecodePendingFileTreeRefreshPath = null;
    return;
  }

  const relParts = parentPath.slice(projectRoot.length).replace(/^\/+/, "").split("/").filter(Boolean);
  let node = rootNode;
  let cumulative = projectRoot;
  for (let i = 0; i < relParts.length; i++) {
    cumulative += "/" + relParts[i];
    ideExpandedFolders.add(cumulative);
    let child = node.children && node.children[relParts[i]];
    if (!child && node.children) {
      const childNames = Object.keys(node.children);
      for (let j = 0; j < childNames.length; j++) {
        const candidate = node.children[childNames[j]];
        if (_livecodeNormalizePath(candidate.path) === cumulative) {
          child = candidate;
          break;
        }
      }
    }
    if (!child) {
      node.expanded = true;
      ideExpandedFolders.add(node.path);
      loadIDEFileTree(node.path, node);
      return;
    }
    child.expanded = true;
    ideExpandedFolders.add(child.path);
    if (!child.loaded) {
      loadIDEFileTree(child.path, child);
      return;
    }
    node = child;
  }

  if (_livecodeInsertFileIntoTree(filePath)) {
    _livecodePendingFileTreeRefreshPath = null;
  }
}

function _livecodeRefreshFileTreeForPath(absPath) {
  const normalized = _livecodeNormalizePath(absPath);
  if (!normalized || !livecodeProjectPath) return;
  _livecodePendingFileTreeRefreshPath = normalized;
  _livecodeTryRefreshFileTreeForPending();
}

let _livecodeFileTreeRenderRaf = null;
let _livecodeFileTreeRenderArgs = null;

function _livecodeToggleFolderChevron(item, expanded) {
  const chevron = item.querySelector(".ide-chevron-expanded, .ide-chevron-collapsed");
  if (!chevron) return;
  chevron.classList.toggle("ide-chevron-expanded", expanded);
  chevron.classList.toggle("ide-chevron-collapsed", !expanded);
}

function _livecodeScheduleFileTreeRender(treeData, container, rootPath) {
  _livecodeFileTreeRenderArgs = { treeData: treeData, container: container, rootPath: rootPath };
  if (_livecodeFileTreeRenderRaf != null) return;
  _livecodeFileTreeRenderRaf = requestAnimationFrame(function() {
    _livecodeFileTreeRenderRaf = null;
    const args = _livecodeFileTreeRenderArgs;
    _livecodeFileTreeRenderArgs = null;
    if (args) _livecodeRenderFileTreeNow(args.treeData, args.container, args.rootPath);
  });
}

function renderFileTree(treeData, container, rootPath) {
  _livecodeScheduleFileTreeRender(treeData, container, rootPath);
}

function _livecodeRenderFileTreeNow(treeData, container, rootPath) {
  container.innerHTML = "";
  function renderNode(node, name, fullPath, level, parentPath, parentContainer) {
    if (!ideShowHiddenFiles && name.startsWith(".")) {
      return;
    }
    const isFolder = node.is_dir || node.type === "folder";
    const icon = isFolder ? "/asset/common/folder.png" : window.getFileIcon(name);
    const indent = level * 16;
    const isExpanded = node.expanded && ideExpandedFolders.has(node.path);
    const hasChildren = isFolder && node.children && Object.keys(node.children).length > 0;
    const item = document.createElement("div");
    item.className = isFolder ? "folder-item theme-transition" : "file-item theme-transition";
    item.style.cssText = `padding:2px 4px;padding-left:${4 + indent}px;cursor:pointer;display:flex;align-items:center;gap:4px;font-size:13px;border-radius:0;min-width:max-content;`;
    let chevron = "";
    if (isFolder) {
      const chevronClass = isExpanded ? "ide-chevron-expanded" : "ide-chevron-collapsed";
      chevron = `<span class="${chevronClass}" style="width:12px;height:12px;display:inline-block;margin-right:6px;vertical-align:middle;"></span>`;
    } else {
      chevron = '<span style="width:12px;display:inline-block;margin-right:6px;"></span>';
    }
    item.innerHTML = `\n              ${chevron}\n              <img src="${icon}" alt="${isFolder ? "Folder" : "File"}" style="width: 16px; height: 16px; flex-shrink: 0;" onerror="this.onerror=null;this.src='${window.DEFAULT_FILE_ICON}'" />\n              <span style="white-space:nowrap;min-width:0;">${name}</span>\n            `;
    item.draggable = true;
    item.addEventListener("dragstart", function(e) {
      if (!e.dataTransfer) return;
      e.stopPropagation();
      const repoPath = _livecodeToRepoPath(node.path);
      const payload = {
        repoPath: repoPath,
        kind: isFolder ? "folder" : "file",
        name: name
      };
      window._livecodeRepoDragPayload = payload;
      e.dataTransfer.setData("application/x-livecode-repo-context", JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "copy";
    });
    item.addEventListener("dragend", function() {
      setTimeout(function() {
        window._livecodeRepoDragPayload = null;
      }, 0);
    });
    const dragImg = item.querySelector("img");
    if (dragImg) dragImg.draggable = false;
    if (!isFolder) {
      item.onclick = e => {
        e.stopPropagation();
        openFileInEditorFromPath(node.path);
      };
      item.oncontextmenu = e => {
        showIDEContextMenu(e, node.path, name, false);
      };
      parentContainer.appendChild(item);
    } else {
      item.oncontextmenu = e => {
        showIDEContextMenu(e, node.path, name, true);
      };
      const wrap = document.createElement("div");
      wrap.className = "ide-tree-folder-wrap";
      wrap.dataset.folderPath = node.path;
      wrap.appendChild(item);
      const childContainer = document.createElement("div");
      childContainer.className = "ide-tree-children";
      childContainer.dataset.treeChildren = node.path;
      childContainer.style.display = isExpanded ? "" : "none";
      wrap.appendChild(childContainer);
      parentContainer.appendChild(wrap);
      item.onclick = e => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        if (node.expanded) {
          ideExpandedFolders.add(node.path);
        } else {
          ideExpandedFolders.delete(node.path);
        }
        if (!node.loaded) {
          loadIDEFileTree(node.path, node);
          return;
        }
        childContainer.style.display = node.expanded ? "" : "none";
        _livecodeToggleFolderChevron(item, node.expanded);
      };
      if (isExpanded && hasChildren) {
        Object.keys(node.children).filter(childName => ideShowHiddenFiles || !childName.startsWith(".")).sort((a, b) => {
          const aIsFolder = node.children[a].is_dir || node.children[a].type === "folder";
          const bIsFolder = node.children[b].is_dir || node.children[b].type === "folder";
          if (aIsFolder && !bIsFolder) return -1;
          if (!aIsFolder && bIsFolder) return 1;
          return a.localeCompare(b);
        }).forEach(childName => {
          const childNode = node.children[childName];
          if (childNode.is_dir && !childNode.loaded && ideExpandedFolders.has(childNode.path)) {
            loadIDEFileTree(childNode.path, childNode);
          }
          renderNode(childNode, childName, fullPath + "/" + childName, level + 1, node.path, childContainer);
        });
      }
    }
  }
  const rootTree = treeData[rootPath] || {};
  if (!rootTree || Object.keys(rootTree).length === 0) {
    container.innerHTML = '<div style="padding:4px 8px;font-size:12px;" class="theme-transition">Loading...</div>';
    return;
  }
  const sortedKeys = Object.keys(rootTree).filter(name => ideShowHiddenFiles || !name.startsWith(".")).sort((a, b) => {
    const aIsFolder = rootTree[a].is_dir || rootTree[a].type === "folder";
    const bIsFolder = rootTree[b].is_dir || rootTree[b].type === "folder";
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.localeCompare(b);
  });
  sortedKeys.forEach(name => {
    renderNode(rootTree[name], name, name, 0, rootPath, container);
  });
}

const LIVECODE_PLAN_TAB_PREFIX = "plan://";
const LIVECODE_PLAN_MERMAID_PREFIX = "livecode-plan-mermaid-";

function _livecodePlanTabKey(planFile) {
  return LIVECODE_PLAN_TAB_PREFIX + planFile;
}

function _livecodeIsPlanTabKey(key) {
  return String(key || "").indexOf(LIVECODE_PLAN_TAB_PREFIX) === 0;
}

function _livecodeIsMarkdownFileName(name) {
  return /\.(md|markdown)$/i.test(String(name || ""));
}

function _livecodeIsPlanFileName(name) {
  return /\.plan\.md$/i.test(String(name || ""));
}

function _livecodeActiveFileInfo() {
  return ideActiveFile ? (ideOpenFiles[ideActiveFile] || null) : null;
}

function _livecodeFileUsesPlanSurface(info) {
  if (!info) return false;
  if (info.isPlan) return true;

  return _livecodeIsMarkdownFileName(info.name);
}

function _livecodeHidePlanSurface() {
  const view = document.getElementById("ide-plan-view");
  if (view) {
    view.style.display = "none";
    view.classList.remove("is-monaco-source");
  }
  const monacoSurface = document.getElementById("ide-monaco");
  if (monacoSurface) monacoSurface.style.top = "0";
  _livecodeClosePlanMenu();
}

let _livecodePlanSourceSaveTimer = null;
let _livecodePlanMonacoListenerBound = false;

function _livecodeSyncPlanSourceFromEditor() {
  const info = _livecodeActiveFileInfo();
  if (!info) return "";
  let next = null;
  if (info.viewMode === "markdown" && window.ideEditor) {
    try {
      const model = window.ideEditor.getModel();
      if (model && (!info.model || info.model === model)) {
        next = window.ideEditor.getValue();
      }
    } catch (e) {}
  }
  if (next == null) {
    const editor = document.getElementById("ide-plan-source-editor");
    if (!editor) return info.content || "";
    next = editor.value;
  }
  info.content = next;
  const original = info.originalContent || "";
  const isModified = next !== original;
  if (info.modified !== isModified) {
    info.modified = isModified;
    updateOpenFilesList();
  }
  return next;
}

function _livecodeBindPlanMonacoAutosave() {
  if (_livecodePlanMonacoListenerBound || !window.ideEditor) return;
  _livecodePlanMonacoListenerBound = true;
  window.ideEditor.onDidChangeModelContent(function() {
    const info = _livecodeActiveFileInfo();
    if (!info || info.viewMode !== "markdown" || !_livecodeFileUsesPlanSurface(info)) return;
    _livecodeSyncPlanSourceFromEditor();
    _livecodeSchedulePlanSourceSave();
  });
}

function _livecodeFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view) {
  if (view) view.classList.remove("is-monaco-source");
  if (monacoSurface) {
    monacoSurface.style.display = "none";
    monacoSurface.style.top = "0";
  }
  if (!body || !fileInfo) return false;
  body.classList.add("is-source");
  body.innerHTML = "";
  const editor = document.createElement("textarea");
  editor.id = "ide-plan-source-editor";
  editor.className = "ide-plan-source-editor theme-transition";
  editor.value = fileInfo.content || "";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Edit markdown");
  editor.addEventListener("input", function() {
    _livecodeSyncPlanSourceFromEditor();
    _livecodeSchedulePlanSourceSave();
  });
  editor.addEventListener("blur", function() {
    clearTimeout(_livecodePlanSourceSaveTimer);
    _livecodeSyncPlanSourceFromEditor();
    _livecodeSavePlanSourceContent(ideActiveFile, { silent: true });
  });
  body.appendChild(editor);
  requestAnimationFrame(function() {
    try { editor.focus(); } catch (e) {}
  });
  return false;
}

function _livecodeFinishMountPlanMarkdownInMonaco(fileKey) {
  const fileInfo = ideOpenFiles[fileKey];
  const view = document.getElementById("ide-plan-view");
  const body = document.getElementById("ide-plan-body");
  const header = document.getElementById("ide-plan-header");
  const monacoSurface = document.getElementById("ide-monaco");
  const codeEditor = document.getElementById("ide-code-editor");
  const placeholder = document.getElementById("ide-editor-placeholder");
  if (!fileInfo || !view || !monacoSurface) return false;
  if (ideActiveFile !== fileKey || fileInfo.viewMode !== "markdown") return false;
  if (placeholder) placeholder.style.display = "none";
  if (body) {
    body.classList.remove("is-source");
    body.innerHTML = "";
  }
  view.classList.add("is-monaco-source");
  if (codeEditor) codeEditor.style.display = "none";
  if (!window.ideEditor || !window.monaco || !window.monaco.editor) {
    return _livecodeFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
  }
  const top = header ? Math.max(header.offsetHeight, 38) : 38;
  monacoSurface.style.display = "block";
  monacoSurface.style.top = top + "px";
  monacoSurface.style.zIndex = "1";
  const detectedLang = typeof window.inferLangFromPath === "function"
    ? window.inferLangFromPath(fileInfo.name || fileKey)
    : "markdown";
  const monacoLang = typeof window.mapToMonacoLang === "function"
    ? window.mapToMonacoLang(detectedLang)
    : "markdown";
  if (!fileInfo.model) {
    try {
      const uri = (fileInfo.path || fileKey).startsWith("/")
        ? monaco.Uri.file(fileInfo.path || fileKey)
        : monaco.Uri.parse("inmemory://ide/" + encodeURIComponent(String(fileKey).replace(/^\/+/, "")));
      fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang, uri);
    } catch (e) {
      try {
        fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang);
      } catch (e2) {
        console.error("LiveCode: could not create Monaco model for markdown", e2);
        return _livecodeFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
      }
    }
  } else {
    try {
      if (fileInfo.model.getValue() !== (fileInfo.content || "")) {
        fileInfo.model.setValue(fileInfo.content || "");
      }
      monaco.editor.setModelLanguage(fileInfo.model, monacoLang);
    } catch (e) {}
  }
  try {
    window.ideEditor.setModel(fileInfo.model);
  } catch (e) {
    console.error("LiveCode: setModel failed for plan markdown", e);
    return _livecodeFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
  }
  _livecodeBindPlanMonacoAutosave();
  requestAnimationFrame(function() {
    try {
      window.ideEditor.layout();
      window.ideEditor.focus();
    } catch (e) {}
  });
  return true;
}

function _livecodeMountPlanMarkdownInMonaco(fileKey) {
  const fileInfo = ideOpenFiles[fileKey];
  const view = document.getElementById("ide-plan-view");
  const body = document.getElementById("ide-plan-body");
  const monacoSurface = document.getElementById("ide-monaco");
  if (!fileInfo || !view || !monacoSurface) return false;
  if (body) {
    body.classList.remove("is-source");
    body.innerHTML = "";
  }
  view.classList.add("is-monaco-source");
  if (!window.ideEditor) {
    try { initializeIDEEditor(); } catch (e) {
      console.error("LiveCode: Monaco init failed for plan markdown", e);
    }
  }
  if (window.ideEditor) {
    return _livecodeFinishMountPlanMarkdownInMonaco(fileKey);
  }

  let tries = 0;
  const wait = setInterval(function() {
    tries += 1;
    if (window.ideEditor) {
      clearInterval(wait);
      _livecodeFinishMountPlanMarkdownInMonaco(fileKey);
      return;
    }
    if (tries >= 50) {
      clearInterval(wait);
      _livecodeFallbackPlanMarkdownTextarea(fileInfo, body, monacoSurface, view);
    }
  }, 100);
  return false;
}

function _livecodeSavePlanSourceContent(fileKey, options) {
  const opts = options || {};
  const key = fileKey || ideActiveFile;
  const info = key ? ideOpenFiles[key] : null;
  if (!info) return Promise.resolve(false);
  const content = opts.content != null ? String(opts.content) : (info.content || "");
  if (content === (info.originalContent || "") && !opts.force) {
    info.modified = false;
    return Promise.resolve(true);
  }
  if (info.isPlan && info.planFile) {
    return fetch("/livecode/plan/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: info.planFile,
        content: content,
        title: info.title || info.name || "",
      }),
    })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) throw new Error((data && data.error) || "Save failed");
        info.content = data.content != null ? data.content : content;
        info.originalContent = info.content;
        info.modified = false;
        if (data.title) info.title = data.title;
        updateOpenFilesList();
        if (!opts.silent) _livecodeSetPlanStatus("Plan saved");
        return true;
      })
      .catch(function(err) {
        console.error("LiveCode: plan save failed", err);
        if (!opts.silent) _livecodeSetPlanStatus("Save failed: " + (err.message || err));
        return false;
      });
  }
  if (!info.path || _livecodeIsPlanTabKey(info.path)) {
    info.content = content;
    info.originalContent = content;
    info.modified = false;
    updateOpenFilesList();
    return Promise.resolve(true);
  }
  return _livecodeIdeSocketRequest(
    "ide_write_file", { path: info.path, content: content },
    "ide_file_saved",
    function(data) { return data && data.path === info.path; }
  ).then(function(result) {
    const data = result.data;
    if (data && data.error) {
      console.error("LiveCode: markdown save failed", data.error);
      if (!opts.silent) _livecodeSetPlanStatus("Save failed: " + data.error);
      return false;
    }
    info.content = content;
    info.originalContent = content;
    info.modified = false;
    updateOpenFilesList();
    if (!opts.silent) _livecodeSetPlanStatus("Saved");
    return true;
  });
}

function _livecodeSchedulePlanSourceSave() {
  clearTimeout(_livecodePlanSourceSaveTimer);
  _livecodePlanSourceSaveTimer = setTimeout(function() {
    _livecodeSyncPlanSourceFromEditor();
    _livecodeSavePlanSourceContent(ideActiveFile, { silent: true });
  }, 800);
}

function _livecodeRenderPlanSurface(fileKey) {
  const info = ideOpenFiles[fileKey];
  const view = document.getElementById("ide-plan-view");
  const body = document.getElementById("ide-plan-body");
  if (!info || !view || !body) return false;
  const placeholder = document.getElementById("ide-editor-placeholder");
  const monacoSurface = document.getElementById("ide-monaco");
  const codeEditor = document.getElementById("ide-code-editor");
  if (placeholder) placeholder.style.display = "none";
  if (codeEditor) codeEditor.style.display = "none";
  view.style.display = "flex";

  const rootEl = document.getElementById("ide-plan-breadcrumb-root");
  const nameEl = document.getElementById("ide-plan-name");
  if (rootEl) rootEl.textContent = info.isPlan ? "Plans" : (livecodeProjectName || "Workspace");
  if (nameEl) nameEl.textContent = info.name || "";
  _livecodeSetPlanStatus("");

  const markdown = info.content || "";
  if (info.viewMode === "markdown") {
    _livecodeMountPlanMarkdownInMonaco(fileKey);
  } else {
    view.classList.remove("is-monaco-source");
    if (monacoSurface) {
      monacoSurface.style.display = "none";
      monacoSurface.style.top = "0";
    }
    body.classList.remove("is-source");
    if (typeof window.renderMarkdownLikeMdpdfPreview === "function") {
      window.renderMarkdownLikeMdpdfPreview(body, markdown, LIVECODE_PLAN_MERMAID_PREFIX);
    } else if (typeof window.renderMarkdownInElement === "function") {
      window.renderMarkdownInElement(body, markdown);
    } else {
      body.textContent = markdown;
    }
    body.scrollTop = 0;
  }
  updateIdePlanChrome();
  return true;
}

function _livecodeSetPlanStatus(message) {
  const el = document.getElementById("ide-plan-status");
  if (!el) return;
  if (!message) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.style.display = "inline-flex";
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(function() {
    el.style.display = "none";
    el.textContent = "";
  }, 4000);
}

function updateIdePlanChrome() {
  const info = _livecodeActiveFileInfo();
  const isPlan = !!(info && (info.isPlan || _livecodeIsPlanFileName(info.name)));
  const buildBtn = document.getElementById("ide-plan-build");
  if (buildBtn) buildBtn.style.display = isPlan ? "inline-flex" : "none";
  const previewBtn = document.getElementById("ide-md-preview-button");

  if (previewBtn) previewBtn.style.display = "none";
  const menu = document.getElementById("ide-plan-menu");
  if (menu && menu.style.display !== "none") _livecodeRenderPlanMenu();
}

window.openLiveCodePlanTab = function(planFile, title, options) {
  const file = String(planFile || "").trim();
  if (!file) return Promise.resolve(false);
  const opts = options || {};
  const key = _livecodePlanTabKey(file);
  return fetch("/livecode/plan-content?file=" + encodeURIComponent(file))
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (!data || !data.ok) throw new Error((data && data.error) || "Plan not found");
      const existing = ideOpenFiles[key];
      const content = data.content || "";
      ideOpenFiles[key] = {
        isPlan: true,
        planFile: file,
        path: key,
        name: file,
        title: data.title || title || file,
        content: content,
        originalContent: content,
        modified: false,
        viewMode: (existing && existing.viewMode) || "preview",
      };
      if (opts.activate === false && ideActiveFile !== key) {
        updateOpenFilesList();
      } else {
        switchToFile(key);
      }
      updatePlayButtonVisibility();
      if (livecodeProjectPath) _livecodePersistEditorTabsDebounced(livecodeProjectPath);
      return true;
    })
    .catch(function(err) {
      console.error("LiveCode: could not open plan", file, err);
      return false;
    });
};

window.setLiveCodePlanViewMode = function(mode) {
  const info = _livecodeActiveFileInfo();
  if (!info) return;
  clearTimeout(_livecodePlanSourceSaveTimer);
  _livecodeSyncPlanSourceFromEditor();
  const next = mode === "markdown" ? "markdown" : "preview";
  const finish = function() {
    info.viewMode = next;
    _livecodeClosePlanMenu();
    const planBody = document.getElementById("ide-plan-body");
    const planView = document.getElementById("ide-plan-view");
    if (planBody) planBody.style.transition = "none";
    if (planView) planView.style.transition = "none";
    switchToFile(ideActiveFile);
    requestAnimationFrame(function() {
      if (planBody) planBody.style.transition = "";
      if (planView) planView.style.transition = "";
    });
  };
  if (info.modified) {
    _livecodeSavePlanSourceContent(ideActiveFile, { silent: true }).then(finish);
  } else {
    finish();
  }
};

window.toggleLiveCodeMarkdownPreview = function() {
  const info = _livecodeActiveFileInfo();
  if (!info || !_livecodeIsMarkdownFileName(info.name)) return;
  window.setLiveCodePlanViewMode(info.viewMode === "preview" ? "markdown" : "preview");
};

function _livecodeRenderPlanMenu() {
  const menu = document.getElementById("ide-plan-menu");
  const info = _livecodeActiveFileInfo();
  if (!menu || !info) return;
  const mode = info.viewMode === "markdown" ? "markdown" : "preview";
  const check = '<svg class="ide-plan-menu-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const modeItem = function(value, label) {
    return '<button type="button" class="ide-plan-menu-item theme-transition" role="menuitemradio" aria-checked="'
      + (mode === value) + '" onclick="setLiveCodePlanViewMode(\'' + value + '\'); return false;">'
      + '<span>' + label + '</span>' + (mode === value ? check : "") + "</button>";
  };
  let html = '<div class="ide-plan-menu-label">Editor Mode</div>';
  html += modeItem("preview", "Preview");
  html += modeItem("markdown", "Markdown");
  html += '<div class="ide-plan-menu-sep"></div>';
  if (info.isPlan) {
    html += '<button type="button" class="ide-plan-menu-item theme-transition" role="menuitem" onclick="saveLiveCodePlanToWorkspace(); return false;"><span>Save to Workspace</span></button>';
  }
  html += '<button type="button" class="ide-plan-menu-item theme-transition" role="menuitem" onclick="downloadLiveCodeMarkdownPdf(); return false;"><span>Download PDF</span></button>';
  menu.innerHTML = html;
}

function _livecodeClosePlanMenu() {
  const menu = document.getElementById("ide-plan-menu");
  const btn = document.getElementById("ide-plan-menu-btn");
  if (menu) menu.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

window.toggleLiveCodePlanMenu = function(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById("ide-plan-menu");
  const btn = document.getElementById("ide-plan-menu-btn");
  if (!menu || !btn) return;
  if (menu.style.display === "block") {
    _livecodeClosePlanMenu();
    return;
  }
  _livecodeRenderPlanMenu();
  menu.style.display = "block";
  btn.setAttribute("aria-expanded", "true");
  if (!window._livecodePlanMenuGlobalBound) {
    window._livecodePlanMenuGlobalBound = true;
    document.addEventListener("click", function(e) {
      const open = document.getElementById("ide-plan-menu");
      if (!open || open.style.display !== "block") return;
      if (e.target.closest("#ide-plan-menu") || e.target.closest("#ide-plan-menu-btn")) return;
      _livecodeClosePlanMenu();
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") _livecodeClosePlanMenu();
    });
  }
};

window.saveLiveCodePlanToWorkspace = function() {
  const info = _livecodeActiveFileInfo();
  if (!info || !info.isPlan || !info.planFile) return;
  if (!livecodeProjectPath) {
    _livecodeSetPlanStatus("Open a project folder first");
    return;
  }
  _livecodeClosePlanMenu();
  clearTimeout(_livecodePlanSourceSaveTimer);
  _livecodeSyncPlanSourceFromEditor();
  const doSave = function() {
    fetch("/livecode/plan/save-to-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: info.planFile, project_path: livecodeProjectPath }),
    })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !data.ok) throw new Error((data && data.error) || "Save failed");
        _livecodeSetPlanStatus("Saved to " + data.relative_path);
        if (livecodeProjectPath) loadIDEFileTree(livecodeProjectPath);
      })
      .catch(function(err) {
        _livecodeSetPlanStatus("Save failed: " + (err.message || err));
      });
  };
  _livecodeSavePlanSourceContent(ideActiveFile, { silent: true }).then(doSave);
};

window.downloadLiveCodeMarkdownPdf = function() {
  const info = _livecodeActiveFileInfo();
  if (!info) return;
  _livecodeClosePlanMenu();
  if (typeof window.downloadMarkdownAsPdf !== "function") return;

  if (info.viewMode === "markdown") {
    info.viewMode = "preview";
    _livecodeRenderPlanSurface(ideActiveFile);
  }
  const body = document.getElementById("ide-plan-body");
  if (!body) return;
  const fileName = String(info.name || "document").replace(/\.(plan\.md|md|markdown)$/i, "") + ".pdf";
  const markdown = info.content || "";
  const renderPromise =
    typeof window.renderMarkdownLikeMdpdfPreview === "function"
      ? window.renderMarkdownLikeMdpdfPreview(body, markdown, LIVECODE_PLAN_MERMAID_PREFIX)
      : Promise.resolve();
  _livecodeSetPlanStatus("Exporting PDF…");
  Promise.resolve(renderPromise)
    .then(function() {
      return window.downloadMarkdownAsPdf(body, fileName);
    })
    .then(function() {
      _livecodeSetPlanStatus("PDF downloaded");
    })
    .catch(function() {
      _livecodeSetPlanStatus("PDF export failed");
    });
};

window.buildLiveCodePlan = function() {
  const info = _livecodeActiveFileInfo();
  if (!info || !info.isPlan || !info.planFile) return;
  if (!livecodeProjectPath) {
    _livecodeSetPlanStatus("Open a project folder first");
    return;
  }
  const tab = _livecodeGetActiveChatTab();
  if (tab && tab.agentRunning) {
    _livecodeSetPlanStatus("Agent is still running");
    return;
  }
  clearTimeout(_livecodePlanSourceSaveTimer);
  _livecodeSyncPlanSourceFromEditor();
  const startBuild = function() {
    window.livecodeChatMode = "agent";
    try { localStorage.setItem(LIVECODE_CHAT_MODE_STORAGE_KEY, "agent"); } catch (e) {}
    _livecodeApplyChatModeToUI();
    toggleLiveCodeAgentPane(true);
    window.sendLiveCodeAgentMessage(
      "Implement the approved plan: " + (info.title || info.name),
      { mode: "agent", planFile: info.planFile }
    );
  };
  _livecodeSavePlanSourceContent(ideActiveFile, { silent: true, force: !!info.modified }).then(function(ok) {
    if (info.modified && !ok) {
      _livecodeSetPlanStatus("Save plan edits before building");
      return;
    }
    startBuild();
  });
};

document.addEventListener("keydown", function(e) {
  if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
  const view = document.getElementById("ide-plan-view");
  if (!view || view.style.display === "none") return;
  const info = _livecodeActiveFileInfo();
  if (!info || !info.isPlan) return;
  if (e.target && e.target.closest && e.target.closest(".chatbot-composer")) return;
  e.preventDefault();
  window.buildLiveCodePlan();
});

let _livecodeIdeToastEl = null;
let _livecodeIdeToastTimer = null;

function _livecodeShowIdeToast(message) {
  if (!_livecodeIdeToastEl) {
    _livecodeIdeToastEl = document.createElement("div");
    _livecodeIdeToastEl.className = "chat-history-menu theme-transition";
    _livecodeIdeToastEl.style.position = "fixed";
    _livecodeIdeToastEl.style.top = "auto";
    _livecodeIdeToastEl.style.right = "auto";
    _livecodeIdeToastEl.style.bottom = "20px";
    _livecodeIdeToastEl.style.left = "50%";
    _livecodeIdeToastEl.style.transform = "translateX(-50%)";
    _livecodeIdeToastEl.style.zIndex = "10060";
    _livecodeIdeToastEl.style.maxWidth = "60vw";
    _livecodeIdeToastEl.style.fontSize = "12px";
    _livecodeIdeToastEl.style.fontWeight = "600";
    _livecodeIdeToastEl.style.display = "none";
    document.body.appendChild(_livecodeIdeToastEl);
  }
  _livecodeIdeToastEl.textContent = message;
  _livecodeIdeToastEl.style.display = "flex";
  if (_livecodeIdeToastTimer) clearTimeout(_livecodeIdeToastTimer);
  _livecodeIdeToastTimer = setTimeout(function() {
    if (_livecodeIdeToastEl) _livecodeIdeToastEl.style.display = "none";
  }, 4000);
}

function _livecodeNormalizeLineNumber(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function _livecodeRevealEditorLine(lineNumber) {
  const line = _livecodeNormalizeLineNumber(lineNumber);
  if (!line) return;
  if (window.ideEditor) {
    try {
      window.ideEditor.setPosition({ lineNumber: line, column: 1 });
      window.ideEditor.revealLineInCenter(line);
      window.ideEditor.focus();
      return;
    } catch (_) {}
  }
  const codeEditor = document.getElementById("ide-code-editor");
  if (codeEditor && codeEditor.style.display !== "none") {
    const lines = String(codeEditor.value || "").split("\n");
    let offset = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    codeEditor.focus();
    try { codeEditor.setSelectionRange(offset, offset); } catch (_) {}
  }
}

function openFileInEditorFromPath(filePath, options) {
  const opts = options || {};
  if (ideOpenFiles[filePath]) {
    switchToFile(filePath, opts);
    return;
  }
  _livecodeIdeSocketRequest(
    "ide_read_file", { path: filePath },
    "ide_file_content",
    function(data) { return data && data.path === filePath; }
  ).then(function(result) {
    const data = result.data;
    if (data.error) {
      console.error("Error reading file:", data.error);
      _livecodeShowIdeToast(
        result.error === "timeout"
          ? "Timed out opening " + filePath.split("/").pop()
          : "Couldn't open " + filePath.split("/").pop() + ": " + data.error
      );
      return;
    }
    const content = data.content || "";
    const fileName = filePath.split("/").pop();
    ideOpenFiles[filePath] = {
      content: content,
      path: filePath,
      name: fileName,
      modified: false,
      originalContent: content,
      readOnlyLarge: !!data.large_file,
    };
    if (data.large_file) {
      _livecodeShowIdeToast("Large file opened read-only: " + fileName);
    }
    switchToFile(filePath, opts);
    updatePlayButtonVisibility();
    if (livecodeProjectPath) _livecodePersistEditorTabsDebounced(livecodeProjectPath);
    if (opts && opts.lineNumber) {
      _livecodeRevealEditorLine(opts.lineNumber);
    }
  });
}

function _livecodeUpdateOpenFileTabBadge(filePath) {
  const filesList = document.getElementById("ide-open-files-list");
  if (!filesList) return;
  const file = ideOpenFiles[filePath];
  if (!file) return;
  const item = Array.from(filesList.querySelectorAll(".ide-open-file-item")).find(function(el) {
    return el.dataset.path === filePath;
  });
  if (!item) {
    updateOpenFilesList(true);
    return;
  }
  const isActive = ideActiveFile === filePath;
  item.classList.toggle("active", isActive);
  const nameSpan = item.querySelector("span.theme-transition");
  if (!nameSpan) return;
  nameSpan.style.cssText = isActive ? "font-weight:500;" : "opacity:0.7;";
  let mod = nameSpan.querySelector(".livecode-modified-badge");
  if (file.modified) {
    if (!mod) {
      mod = document.createElement("span");
      mod.className = "livecode-modified-badge theme-transition";
      mod.style.cssText = "font-size:10px;opacity:0.7;margin-left:4px;";
      mod.textContent = "M";
      nameSpan.appendChild(mod);
    }
  } else if (mod) {
    mod.remove();
  }
}

function updateOpenFilesList(forceRebuild) {
  const filesList = document.getElementById("ide-open-files-list");
  if (!filesList) return;
  const openPaths = Object.keys(ideOpenFiles);
  if (openPaths.length === 0) {
    filesList.innerHTML = "";
    filesList.style.display = "none";
    return;
  }
  filesList.style.display = "flex";
  if (!forceRebuild) {
    const existingItems = filesList.querySelectorAll(".ide-open-file-item");
    if (existingItems.length === openPaths.length) {
      const existingPaths = new Set(Array.from(existingItems).map(function(el) { return el.dataset.path; }));
      if (openPaths.every(function(p) { return existingPaths.has(p); })) {
        openPaths.forEach(function(filePath) {
          _livecodeUpdateOpenFileTabBadge(filePath);
        });
        return;
      }
    }
  }
  filesList.innerHTML = "";
  openPaths.forEach(filePath => {
    const file = ideOpenFiles[filePath];
    const isActive = ideActiveFile === filePath;
    const fileItem = document.createElement("div");
    fileItem.className = `ide-open-file-item theme-transition${isActive ? " active" : ""}`;
    fileItem.style.cssText = `padding:4px 12px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;user-select:none;border-radius:0;`;
    fileItem.dataset.path = filePath;
    const iconPath = window.getFileIcon(file.name);
    const iconImg = document.createElement("img");
    iconImg.src = iconPath;
    iconImg.alt = "File";
    iconImg.style.cssText = "width:16px;height:16px;flex-shrink:0;display:block;";
    iconImg.onerror = function() {
      this.src = window.DEFAULT_FILE_ICON;
      this.onerror = null;
    };
    const fileNameSpan = document.createElement("span");
    fileNameSpan.textContent = file.name;
    fileNameSpan.className = "theme-transition";
    fileNameSpan.style.cssText = isActive ? "font-weight:500;" : "opacity:0.7;";
    if (file.modified) {
      const modifiedIndicator = document.createElement("span");
      modifiedIndicator.textContent = "M";
      modifiedIndicator.className = "livecode-modified-badge theme-transition";
      modifiedIndicator.style.cssText = "font-size:10px;opacity:0.7;margin-left:4px;";
      fileNameSpan.appendChild(modifiedIndicator);
    }
    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.className = "ide-file-close theme-transition";
    closeBtn.style.cssText = "width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:0;opacity:0.5;margin-left:auto;";
    closeBtn.onclick = e => {
      e.stopPropagation();
      closeFile(filePath);
    };
    fileItem.appendChild(iconImg);
    fileItem.appendChild(fileNameSpan);
    fileItem.appendChild(closeBtn);
    fileItem.onclick = () => switchToFile(filePath);
    filesList.appendChild(fileItem);
  });
}

function switchToFile(filePath, options) {
  if (!ideOpenFiles[filePath]) return;
  const opts = options || {};
  if (_livecodeFileUsesPlanSurface(ideOpenFiles[filePath])) {
    ideActiveFile = filePath;
    _livecodeRenderPlanSurface(filePath);
    updateOpenFilesList();
    if (livecodeProjectPath) _livecodePersistEditorTabsDebounced(livecodeProjectPath);
    return;
  }
  _livecodeHidePlanSurface();
  const placeholder = document.getElementById("ide-editor-placeholder");
  const codeEditor = document.getElementById("ide-code-editor");
  if (placeholder) placeholder.style.display = "none";
  const monacoSurface = document.getElementById("ide-monaco");
  if (monacoSurface && window.ideEditor && window.monaco && window.monaco.editor) {
    if (codeEditor) codeEditor.style.display = "none";
    monacoSurface.style.display = "block";
    const fileInfo = ideOpenFiles[filePath];
    const detectedLang = typeof window.inferLangFromPath === "function" ? window.inferLangFromPath(fileInfo.name || filePath) : "text";
    let monacoLang = typeof window.mapToMonacoLang === "function" ? window.mapToMonacoLang(detectedLang) : "plaintext";
    if (fileInfo.readOnlyLarge) {
      monacoLang = "plaintext";
    }
    if (!fileInfo.model) {
      try {
        const uri = filePath.startsWith("/")
          ? monaco.Uri.file(filePath)
          : monaco.Uri.parse("inmemory://ide/" + encodeURIComponent(filePath.replace(/^\/+/, "")));
        fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang, uri);
      } catch (e) {
        try {
          fileInfo.model = monaco.editor.createModel(fileInfo.content || "", monacoLang);
        } catch (e2) {
          if (codeEditor) {
            codeEditor.style.display = "block";
            codeEditor.value = fileInfo.content || "";
            codeEditor.readOnly = !!fileInfo.readOnlyLarge;
            return;
          }
        }
      }
    } else {
      const modelContent = fileInfo.model.getValue();
      const desiredContent = fileInfo.content || "";
      if (modelContent !== desiredContent) {
        fileInfo.model.setValue(desiredContent);
      }
      if (fileInfo.model.getLanguageId() !== monacoLang) {
        try {
          monaco.editor.setModelLanguage(fileInfo.model, monacoLang);
        } catch (e) {}
      }
    }
    try {
      window.ideEditor.setModel(fileInfo.model);
      window.ideEditor.updateOptions({ readOnly: !!fileInfo.readOnlyLarge });
      requestAnimationFrame(function() {
        try { window.ideEditor.layout(); } catch (_) {}
      });
    } catch (e) {
      if (codeEditor) {
        codeEditor.style.display = "block";
        codeEditor.value = fileInfo.content || "";
        codeEditor.readOnly = !!fileInfo.readOnlyLarge;
        return;
      }
    }
  } else if (monacoSurface && window.monaco && !window.ideEditor) {
    if (codeEditor) {
      codeEditor.style.display = "block";
      const fileInfo = ideOpenFiles[filePath];
      codeEditor.value = fileInfo.content || "";
      codeEditor.readOnly = !!fileInfo.readOnlyLarge;
    }
  } else if (codeEditor) {
    codeEditor.style.display = "block";
    const fileInfo = ideOpenFiles[filePath];
    codeEditor.value = fileInfo.content || "";
    codeEditor.readOnly = !!fileInfo.readOnlyLarge;
  }
  ideActiveFile = filePath;
  updateOpenFilesList();
  updatePlayButtonVisibility();
  if (livecodeProjectPath) _livecodePersistEditorTabsDebounced(livecodeProjectPath);
  if (opts && opts.lineNumber) {
    _livecodeRevealEditorLine(opts.lineNumber);
  }
}

function autoSaveIDEFile(filePath) {
  if (!filePath || !ideOpenFiles[filePath] || !window.ideEditor) {
    return;
  }
  const file = ideOpenFiles[filePath];
  if (file.readOnlyLarge) return;

  if (_livecodeFileUsesPlanSurface(file) && file.viewMode === "markdown") {
    _livecodeSyncPlanSourceFromEditor();
    _livecodeSavePlanSourceContent(filePath, { silent: true });
    return;
  }
  const content = window.ideEditor.getValue();
  if (content === file.originalContent) {
    return;
  }
  _livecodeIdeSocketRequest(
    "ide_write_file", { path: file.path, content: content },
    "ide_file_saved",
    function(data) { return data && data.path === file.path; }
  ).then(function(result) {
    const data = result.data;
    if (data.error) {
      console.error("Auto-save error:", data.error);
      if (result.error) _livecodeShowIdeToast("Auto-save failed for " + (file.name || file.path.split("/").pop()));
    } else {
      file.originalContent = content;
      file.modified = false;
      _livecodeUpdateOpenFileTabBadge(filePath);
    }
  });
}

function showIDEPanel(panelName) {
  const recentBtn = document.getElementById("ide-activity-recent");
  if (recentBtn) {
    const recentActive = panelName === "recent" || panelName === "settings";
    recentBtn.classList.toggle("active", recentActive);
    recentBtn.setAttribute("aria-pressed", recentActive ? "true" : "false");
  }
  const explorerPanel = document.getElementById("ide-explorer-panel");
  const recentPanel = document.getElementById("ide-recent-panel");
  const panelContent = document.getElementById("ide-panel-content");
  if (explorerPanel) explorerPanel.style.display = "none";
  if (recentPanel) recentPanel.style.display = "none";
  if (panelName === "explorer") {
    if (explorerPanel) explorerPanel.style.display = "block";
    if (recentPanel) recentPanel.style.display = "none";
    if (panelContent) {
      panelContent.style.overflowX = "auto";
      panelContent.style.overflowY = "auto";
    }
  } else if (panelName === "recent" || panelName === "settings") {
    if (explorerPanel) explorerPanel.style.display = "none";
    if (recentPanel) {
      recentPanel.style.display = "block";
      renderLiveCodeRecentProjects();
    }
    if (panelContent) {
      panelContent.style.overflowX = "hidden";
      panelContent.style.overflowY = "auto";
    }
  } else {
    if (explorerPanel) explorerPanel.style.display = "block";
    if (recentPanel) recentPanel.style.display = "none";
    if (panelContent) {
      panelContent.style.overflowX = "auto";
      panelContent.style.overflowY = "auto";
    }
  }
}

function toggleHiddenFiles() {
  const checkbox = document.getElementById("ide-show-hidden-files");
  if (checkbox) {
    ideShowHiddenFiles = checkbox.checked;
    const fileTreeEl = document.getElementById("ide-file-tree");
    if (fileTreeEl && ideHomePath) {
      renderFileTree(ideFileTreeData, fileTreeEl, ideHomePath);
    }
  }
}

function closeFile(filePath) {
  if (!ideOpenFiles[filePath]) return;
  delete ideOpenFiles[filePath];
  updateOpenFilesList();
  const openPaths = Object.keys(ideOpenFiles);
  if (openPaths.length > 0) {
    switchToFile(openPaths[openPaths.length - 1]);
  } else {
    showLiveCodeEditorIdle();
  }
  updatePlayButtonVisibility();
  if (livecodeProjectPath) _livecodePersistEditorTabsDebounced(livecodeProjectPath);
}

let ideContextMenuTarget = null;

function _livecodeToRepoPath(absPath) {
  const project = livecodeProjectPath || "";
  if (!project || !absPath) return "";
  const norm = function(p) { return String(p || "").replace(/\\/g, "/"); };
  let rel = norm(absPath);
  const root = norm(project).replace(/\/$/, "");
  if (rel === root) return "";
  if (rel.startsWith(root + "/")) rel = rel.slice(root.length + 1);
  return rel;
}

function showIDEContextMenu(e, itemPath, itemName, isDir) {
  const contextMenu = document.getElementById("ide-context-menu");
  if (!contextMenu) return;
  e.preventDefault();
  e.stopPropagation();
  const repoPath = _livecodeToRepoPath(itemPath);
  ideContextMenuTarget = {
    path: itemPath,
    repoPath: repoPath,
    name: itemName,
    isDir: !!isDir,
  };
  const addLabel = isDir ? "Add folder to chat" : "Add file to chat";
  const addAction = isDir ? "add-folder-to-chat" : "add-file-to-chat";
  const iconHtml = isDir
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>`;
  const newChatIconHtml = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>`;
  let html = `<div class="ide-context-menu-item" onclick="ideContextMenuAction('${addAction}');">
    ${iconHtml}
    <span>${addLabel}</span>
  </div>
  <div class="ide-context-menu-separator" role="separator"></div>
  <div class="ide-context-menu-item" onclick="ideContextMenuAction('add-to-new-chat');">
    ${newChatIconHtml}
    <span>Add to new Chat</span>
  </div>`;
  contextMenu.innerHTML = html;
  contextMenu.style.display = "block";
  contextMenu.style.left = e.pageX + "px";
  contextMenu.style.top = e.pageY + "px";
  const closeMenu = function(event) {
    if (!contextMenu.contains(event.target)) {
      contextMenu.style.display = "none";
      document.removeEventListener("click", closeMenu);
    }
  };
  setTimeout(function() {
    document.addEventListener("click", closeMenu);
  }, 100);
}

function showFolderContextMenu(e, folderPath, folderName) {
  showIDEContextMenu(e, folderPath, folderName, true);
}

function _livecodeAddRepoContextToActiveChat(target) {
  if (!target || typeof window.addLivecodeRepoContextToChat !== "function") return false;
  return !!window.addLivecodeRepoContextToChat({
    repoPath: target.repoPath,
    kind: target.isDir ? "folder" : "file",
    name: target.name,
  });
}

function ideContextMenuAction(action) {
  const contextMenu = document.getElementById("ide-context-menu");
  if (contextMenu) {
    contextMenu.style.display = "none";
  }
  const target = ideContextMenuTarget;
  ideContextMenuTarget = null;
  if ((action === "add-file-to-chat" || action === "add-folder-to-chat") && target) {
    _livecodeAddRepoContextToActiveChat(target);
    toggleLiveCodeAgentPane(true);
    return;
  }
  if (action === "add-to-new-chat" && target) {
    if (typeof window.createLiveCodeChatTab === "function") {
      window.createLiveCodeChatTab();
    }
    if (typeof window.clearLivecodeComposer === "function") {
      window.clearLivecodeComposer();
    }
    _livecodeAddRepoContextToActiveChat(target);
    toggleLiveCodeAgentPane(true);
    return;
  }
  if (action === "recent" || action === "settings") {
    showIDEPanel("recent");
  }
}

function getLiveCodeRecentProjects() {
  try {
    const raw = localStorage.getItem(LIVECODE_RECENT_PROJECTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(p => typeof p === "string" && p.length > 0) : [];
  } catch (e) {
    return [];
  }
}

function saveLiveCodeRecentProject(path) {
  if (!path) return;
  let list = getLiveCodeRecentProjects().filter(p => p !== path);
  list.unshift(path);
  list = list.slice(0, 10);
  try {
    localStorage.setItem(LIVECODE_RECENT_PROJECTS_KEY, JSON.stringify(list));
    localStorage.setItem(LIVECODE_LAST_PROJECT_KEY, path);
  } catch (e) {}
}

function removeLiveCodeRecentProject(path) {
  const list = getLiveCodeRecentProjects().filter(p => p !== path);
  try {
    localStorage.setItem(LIVECODE_RECENT_PROJECTS_KEY, JSON.stringify(list));
    const last = localStorage.getItem(LIVECODE_LAST_PROJECT_KEY);
    if (last === path || !list.length) {
      localStorage.removeItem(LIVECODE_LAST_PROJECT_KEY);
    }
  } catch (e) {}
  fetch("/livecode/project-storage", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: path })
  }).catch(() => {});
  renderLiveCodeRecentProjects();
  if (_livecodeProjectMenuOpen) renderLiveCodeProjectDropdown();
}

function renderLiveCodeRecentProjects() {
  const el = document.getElementById("ide-recent-projects-list");
  if (!el) return;
  const list = getLiveCodeRecentProjects();
  if (!list.length) {
    el.innerHTML = '<div style="padding:8px 4px;opacity:0.6;font-size:12px;">No recent projects</div>';
    return;
  }
  el.innerHTML = list.map(p => {
    const name = p.split("/").filter(Boolean).pop() || p;
    const esc = p.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    return `<div class="theme-transition livecode-recent-item${p === livecodeProjectPath ?" is-active" : ""}" style="padding:8px 10px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:6px;margin-bottom:2px;" onclick="setLiveCodeProject('${esc}'); showIDEPanel('explorer'); return false;">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;">
        <span style="font-size:13px;font-weight:${p === livecodeProjectPath ? "600" : "500"};">${name.replace(/</g, "&lt;")}</span>
        <span class="livecode-recent-item-path" style="font-size:10px;opacity:0.55;line-height:1.35;white-space:nowrap;overflow-x:auto;">${p.replace(/</g, "&lt;")}</span>
      </div>
      <button type="button" class="livecode-recent-item-remove" title="Remove from recents" aria-label="Remove from recents" onclick="event.stopPropagation(); removeLiveCodeRecentProject('${esc}'); return false;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    </div>`;
  }).join("");
}

function updateLiveCodeExplorerHeader() {

}
window.updateLiveCodeExplorerHeader = updateLiveCodeExplorerHeader;

function renderLiveCodeExplorerEmpty() {
  const fileTreeEl = document.getElementById("ide-file-tree");
  if (!fileTreeEl) return;
  fileTreeEl.innerHTML = `<div id="ide-explorer-empty" class="theme-transition">
    <div class="ide-explorer-empty-title">Open a project</div>
    <div class="ide-explorer-empty-sub">Pick a folder to browse files and use the agent.</div>
    <button type="button" class="btn btn-ghost theme-transition ide-explorer-empty-btn" onclick="openLiveCodeProjectBrowser(); return false;">Open Folder</button>
  </div>`;
  updateLiveCodeExplorerHeader();
}

window.setLiveCodeProject = function(path) {
  if (!path) return;
  const previousPath = livecodeProjectPath;
  const normPrev = _livecodeNormalizeProjectKey(previousPath);
  const normNext = _livecodeNormalizeProjectKey(path);
  if (normPrev !== normNext) {
    livecodeChatTabs.forEach(function(t) {
      if (t.agentRunning) _livecodeAbortTabTurn(t);
    });
    if (normPrev) {
      _livecodeSaveTabsForProject(previousPath);
      _livecodePersistEditorTabs(previousPath);
    }
    _livecodeClearEditorFiles();
    if (!previousPath) {
      livecodeAgentSessionId = null;
    }
    _livecodeInvalidateSessionFetches();
    if (typeof closeLiveCodeSessionMenu === "function") closeLiveCodeSessionMenu();
  }
  livecodeProjectPath = path;
  livecodeProjectName = path.split("/").filter(Boolean).pop() || path;
  ideHomePath = path;
  ideFileTreeData = {};
  ideExpandedFolders.clear();
  saveLiveCodeRecentProject(path);
  livecodeIndexReady = false;
  livecodeIndexFileCount = 0;
  _livecodeLoadTabsForProject(path);
  const activeTab = _livecodeGetActiveChatTab();
  if (activeTab && !activeTab.chatStarted) {
    livecodeAgentSessionId = activeTab.sessionId || _livecodeNewChatSessionId();
    activeTab.sessionId = livecodeAgentSessionId;
  } else if (!livecodeAgentSessionId) {
    livecodeAgentSessionId = _livecodeNewChatSessionId();
  }
  if (normPrev !== normNext) {
    _livecodeResetTerminalsForProject();
  }
  loadIDEFileTree(path);
  _livecodeRestoreEditorTabs(path);
  toggleLiveCodeAgentPane(true);
  renderLiveCodeRecentProjects();
  if (_livecodeProjectMenuOpen) renderLiveCodeProjectDropdown();
  renderLiveCodeRecentSessions();
  updateLiveCodeExplorerHeader();
  const scheduleIndex = typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : function(cb) { setTimeout(cb, 1); };
  scheduleIndex(function() {
    fetch("/livecode/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_path: path })
    }).then(r => r.json()).then(data => {
      if (data.success) {
        livecodeIndexReady = true;
        livecodeIndexFileCount = data.file_count || 0;
      }
    }).catch(() => {});
  });
};

function updateLiveCodeEditorPlaceholder() {
  const noProject = document.getElementById("ide-editor-placeholder-no-project");
  const noFile = document.getElementById("ide-editor-placeholder-no-file");
  const hasProject = !!livecodeProjectPath;
  if (noProject) noProject.style.display = hasProject ? "none" : "";
  if (noFile) noFile.style.display = hasProject ? "" : "none";
}

function showLiveCodeEditorIdle() {
  ideActiveFile = null;
  const placeholder = document.getElementById("ide-editor-placeholder");
  const monacoSurface = document.getElementById("ide-monaco");
  const codeEditor = document.getElementById("ide-code-editor");
  if (monacoSurface) monacoSurface.style.display = "none";
  if (codeEditor) codeEditor.style.display = "none";
  _livecodeHidePlanSurface();
  updateLiveCodeEditorPlaceholder();
  if (placeholder) placeholder.style.display = "flex";
  if (window.ideEditor) try { window.ideEditor.setModel(null); } catch (e) {}
  updateOpenFilesList();
  updateIdePlanChrome();
}

function initLiveCodeProjectState() {
  _livecodeBindProjectStateListenersOnce();
  let last = null;
  try { last = localStorage.getItem(LIVECODE_LAST_PROJECT_KEY); } catch (e) {}
  if (last) {
    setLiveCodeProject(last);
  } else {
    renderLiveCodeExplorerEmpty();
    updateLiveCodeExplorerHeader();
    updateOpenFilesList();
  }
  initLiveCodeAgentSocket();
  if (!livecodeChatTabs.length) {
    if (!livecodeAgentSessionId) {
      livecodeAgentSessionId = _livecodeNewChatSessionId();
    }
    _livecodeInitChatTabs();
  }
  _livecodeUpdateChatWelcome();
  toggleLiveCodeAgentPane(true);
}

var _livecodeBrowserPath = "~";
var _livecodeBrowserHomePath = null;
var _livecodeBrowserSelected = null;
var _livecodeBrowserSock = null;
var _livecodeBrowserItems = [];
var _livecodeBrowserHistory = [];
var _livecodeBrowserHistoryIndex = -1;
var _livecodeBrowserListHandler = null;

function _livecodeGetBrowserLastPath() {
  try {
    const saved = localStorage.getItem(LIVECODE_BROWSER_LAST_PATH_KEY);
    if (saved && saved !== "~") return saved;
  } catch (e) {}
  return null;
}

function _livecodeSetBrowserLastPath(path) {
  if (!path || path === "~") return;
  try { localStorage.setItem(LIVECODE_BROWSER_LAST_PATH_KEY, path); } catch (e) {}
}

function _livecodeEnsureBrowserSocket() {
  if (!_livecodeBrowserSock) {
    _livecodeBrowserSock = _livecodeGetIdeSocket();
  }
  return _livecodeBrowserSock;
}

function _livecodeGetParentPath(path) {
  if (!path || path === "~") return null;
  const normalized = String(path).replace(/\/$/, "");
  if (!normalized || normalized === "/") return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return "/" + parts.slice(0, -1).join("/");
}

function _livecodeRenderFinderBreadcrumb(actualPath) {
  const el = document.getElementById("livecode-finder-breadcrumb");
  if (!el) return;
  const chevron = '<span class="livecode-finder-breadcrumb-sep">›</span>';
  let html = '<span class="livecode-finder-breadcrumb-item" onclick="livecodeBrowserNavigate(\'~\');return false;">Home</span>';
  if (!actualPath || actualPath === "~") {
    el.innerHTML = html;
    return;
  }
  const parts = actualPath.replace(/\/$/, "").split("/").filter(Boolean);
  let currentPath = "";
  parts.forEach(function(part) {
    currentPath += "/" + part;
    const esc = currentPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    html += chevron + '<span class="livecode-finder-breadcrumb-item" title="' + currentPath.replace(/"/g, "&quot;") + '" onclick="livecodeBrowserNavigate(\'' + esc + '\');return false;">' + part.replace(/</g, "&lt;") + "</span>";
  });
  el.innerHTML = html;
}

function _livecodeUsernameFromHomePath(homePath) {
  if (!homePath) return null;
  const parts = homePath.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function _livecodeUpdateFinderSidebarHomeLabel() {
  const btn = document.querySelector('.livecode-finder-sidebar-item[data-finder-path="~"]');
  if (!btn) return;
  const username = _livecodeUsernameFromHomePath(_livecodeBrowserHomePath);
  btn.textContent = username || "Home";
}

function _livecodeMaybeSetHomePath(actualPath) {
  if (!actualPath || actualPath === "~") return;
  const match = actualPath.match(/^(\/Users\/[^/]+)/) || actualPath.match(/^(\/home\/[^/]+)/i);
  if (match) {
    _livecodeBrowserHomePath = match[1];
    _livecodeUpdateFinderSidebarHomeLabel();
  }
}

function _livecodeUpdateFinderSidebarActive(actualPath) {
  const home = _livecodeBrowserHomePath;
  const desktopPath = home ? home + "/Desktop" : null;
  document.querySelectorAll(".livecode-finder-sidebar-item").forEach(function(btn) {
    const shortcut = btn.getAttribute("data-finder-path") || "";
    let active = false;
    if (shortcut === "~/Desktop" && desktopPath && actualPath) {
      active = actualPath === desktopPath || actualPath.indexOf(desktopPath + "/") === 0;
    } else if (shortcut === "~") {
      if (!actualPath || actualPath === "~") {
        active = true;
      } else if (home) {
        active = actualPath === home;
      }
    }
    btn.classList.toggle("is-active", active);
  });
}

function _livecodeFormatFileSize(bytes) {
  if (bytes == null || bytes === "") return "—";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return n + " bytes";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace(/\.0$/, "") + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10485760 ? 1 : 0).replace(/\.0$/, "") + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " GB";
}

function _livecodeFormatFinderDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return "Today at " + time;
  if (isYesterday) return "Yesterday at " + time;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function _livecodeFinderIcon(item) {
  const name = item.name || "";
  if (item.is_dir || item.type === "folder") {
    return "/asset/common/folder.png";
  }
  if (typeof window.getFileIcon === "function") return window.getFileIcon(name);
  return window.DEFAULT_FILE_ICON;
}

function _livecodeUpdateFinderNavButtons() {
  const back = document.getElementById("livecode-finder-back");
  const fwd = document.getElementById("livecode-finder-forward");
  if (back) back.disabled = _livecodeBrowserHistoryIndex <= 0;
  if (fwd) fwd.disabled = _livecodeBrowserHistoryIndex < 0 || _livecodeBrowserHistoryIndex >= _livecodeBrowserHistory.length - 1;
}

function _livecodePushBrowserHistory(path) {
  if (_livecodeBrowserHistoryIndex >= 0 && _livecodeBrowserHistory[_livecodeBrowserHistoryIndex] === path) return;
  _livecodeBrowserHistory = _livecodeBrowserHistory.slice(0, _livecodeBrowserHistoryIndex + 1);
  _livecodeBrowserHistory.push(path);
  _livecodeBrowserHistoryIndex = _livecodeBrowserHistory.length - 1;
  _livecodeUpdateFinderNavButtons();
}

window.livecodeBrowserGoBack = function() {
  if (_livecodeBrowserHistoryIndex <= 0) return;
  _livecodeBrowserHistoryIndex -= 1;
  livecodeBrowserNavigate(_livecodeBrowserHistory[_livecodeBrowserHistoryIndex], true);
};

window.livecodeBrowserGoForward = function() {
  if (_livecodeBrowserHistoryIndex >= _livecodeBrowserHistory.length - 1) return;
  _livecodeBrowserHistoryIndex += 1;
  livecodeBrowserNavigate(_livecodeBrowserHistory[_livecodeBrowserHistoryIndex], true);
};

window.livecodeBrowserRefresh = function() {
  if (_livecodeBrowserPath) livecodeBrowserNavigate(_livecodeBrowserPath, true);
};

function _livecodeRenderFinderRows(items, selectedPath, currentPath) {
  const tbody = document.getElementById("livecode-browser-list");
  if (!tbody) return;
  let rowsHtml = "";
  const parentPath = _livecodeGetParentPath(currentPath);
  if (parentPath) {
    const parentEsc = parentPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    rowsHtml += `<tr class="livecode-finder-row theme-transition is-folder is-parent" data-path="${parentEsc}" onclick="livecodeBrowserNavigate('${parentEsc}'); return false;">
      <td><div class="livecode-finder-name-cell"><img class="livecode-finder-icon" src="/asset/common/folder.png" alt=""/><span>..</span></div></td>
      <td>—</td>
      <td>Folder</td>
      <td>—</td>
    </tr>`;
  }
  if (!items || !items.length) {
    tbody.innerHTML = rowsHtml || '<tr><td colspan="4" style="padding:24px;text-align:center;opacity:0.6;">Empty folder</td></tr>';
    return;
  }
  rowsHtml += items.map(function(it) {
    const isDir = it.is_dir || it.type === "folder";
    const esc = (it.path || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const name = (it.name || "").replace(/</g, "&lt;");
    const selected = selectedPath && it.path === selectedPath;
    const rowClass = "livecode-finder-row theme-transition" + (isDir ? " is-folder" : " is-file") + (selected ? " is-selected" : "");
    const icon = _livecodeFinderIcon(it);
    const size = isDir ? "—" : _livecodeFormatFileSize(it.size);
    const kind = (it.kind || (isDir ? "Folder" : "Document")).replace(/</g, "&lt;");
    const date = _livecodeFormatFinderDate(it.mtime);
    const click = isDir
      ? `onclick="livecodeBrowserNavigate('${esc}'); return false;"`
      : `onclick="livecodeBrowserSelectFolder('${esc}', false); return false;"`;
    return `<tr class="${rowClass}" data-path="${esc}" ${click}>
      <td><div class="livecode-finder-name-cell"><img class="livecode-finder-icon" src="${icon}" alt="" onerror="this.src='/asset/file-icons/default_file.svg'"/><span>${name}</span></div></td>
      <td>${size}</td>
      <td>${kind}</td>
      <td>${date}</td>
    </tr>`;
  }).join("");
  tbody.innerHTML = rowsHtml;
}

window.livecodeBrowserFilterList = function(query) {
  const q = String(query || "").trim().toLowerCase();
  const filtered = !q ? _livecodeBrowserItems : _livecodeBrowserItems.filter(function(it) {
    return (it.name || "").toLowerCase().includes(q);
  });
  _livecodeRenderFinderRows(filtered, _livecodeBrowserSelected, _livecodeBrowserPath);
};

window.openLiveCodeProjectBrowser = function() {
  const modal = document.getElementById("livecodeProjectBrowserModal");
  if (!modal) return;
  modal.classList.add("open");
  _livecodeBrowserSelected = null;
  _livecodeBrowserHistory = [];
  _livecodeBrowserHistoryIndex = -1;
  const btn = document.getElementById("livecodeBrowserSelectBtn");
  if (btn) btn.disabled = true;
  const search = document.getElementById("livecode-finder-search");
  if (search) search.value = "";
  const sel = document.getElementById("livecode-browser-selected");
  if (sel) { sel.textContent = ""; sel.style.display = "none"; }
  const start = _livecodeGetBrowserLastPath() || livecodeProjectPath || "~";
  _livecodeMaybeSetHomePath(start);
  _livecodeBrowserPath = start;
  livecodeBrowserNavigate(start);
};

window.closeLiveCodeProjectBrowser = function() {
  if (_livecodeBrowserPath && _livecodeBrowserPath !== "~") {
    _livecodeSetBrowserLastPath(_livecodeBrowserPath);
  }
  const modal = document.getElementById("livecodeProjectBrowserModal");
  if (modal) modal.classList.remove("open");
  if (_livecodeBrowserSock && _livecodeBrowserListHandler) {
    _livecodeBrowserSock.off("ide_files_list", _livecodeBrowserListHandler);
    _livecodeBrowserListHandler = null;
  }
};

window.livecodeBrowserNavigate = function(path, skipHistory) {
  _livecodeBrowserPath = path;
  if (!skipHistory) _livecodePushBrowserHistory(path);
  else _livecodeUpdateFinderNavButtons();
  _livecodeBrowserSelected = null;
  const btn = document.getElementById("livecodeBrowserSelectBtn");
  if (btn) btn.disabled = true;
  const sel = document.getElementById("livecode-browser-selected");
  if (sel) { sel.textContent = ""; sel.style.display = "none"; }
  const tbody = document.getElementById("livecode-browser-list");
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;opacity:0.6;">Loading…</td></tr>';
  _livecodeRenderFinderBreadcrumb(path);
  _livecodeUpdateFinderSidebarActive(path);
  if (!livecodeProjectPath) updateLiveCodeExplorerHeader();
  const sock = _livecodeEnsureBrowserSocket();
  if (_livecodeBrowserListHandler) sock.off("ide_files_list", _livecodeBrowserListHandler);
  _livecodeBrowserListHandler = function(data) {
    if (!data) return;
    const matches = data.requested_path !== undefined ? data.requested_path === path : data.path === path;
    if (!matches) return;
    if (data.error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="padding:24px;color:#ef4444;">${data.error}</td></tr>`;
      return;
    }
    const actualPath = data.path || path;
    if (path === "~") {
      _livecodeBrowserHomePath = actualPath;
      _livecodeUpdateFinderSidebarHomeLabel();
    } else {
      _livecodeMaybeSetHomePath(actualPath);
    }
    _livecodeBrowserPath = actualPath;
    _livecodeRenderFinderBreadcrumb(actualPath);
    _livecodeUpdateFinderSidebarActive(actualPath);
    _livecodeSetBrowserLastPath(actualPath);
    if (!livecodeProjectPath) updateLiveCodeExplorerHeader();
    _livecodeBrowserItems = data.files || [];
    const search = document.getElementById("livecode-finder-search");
    window.livecodeBrowserFilterList(search ? search.value : "");
    livecodeBrowserSelectFolder(actualPath, true);
  };
  sock.on("ide_files_list", _livecodeBrowserListHandler);
  sock.emit("ide_list_files", { path: path });
};

window.livecodeBrowserSelectFolder = function(path, isFolder) {
  if (!path) return;
  _livecodeBrowserSelected = path;
  document.querySelectorAll("#livecode-browser-list .livecode-finder-row").forEach(function(row) {
    row.classList.toggle("is-selected", row.dataset.path === path);
  });
  const sel = document.getElementById("livecode-browser-selected");
  const btn = document.getElementById("livecodeBrowserSelectBtn");
  if (isFolder) {
    if (sel) { sel.textContent = path; sel.style.display = "none"; }
    if (btn) btn.disabled = false;
  } else {
    if (sel) { sel.textContent = "Select a folder to open as project"; sel.style.display = "block"; }
    if (btn) btn.disabled = true;
  }
};

window.livecodeBrowserNewFolder = function() {
  const name = prompt("New folder name:");
  if (!name || !name.trim()) return;
  const sock = _livecodeEnsureBrowserSocket();
  sock.off("ide_mkdir_result");
  sock.on("ide_mkdir_result", function(data) {
    sock.off("ide_mkdir_result");
    if (data.error) {
      alert(data.error);
      return;
    }
    livecodeBrowserNavigate(data.parent || _livecodeBrowserPath);
  });
  sock.emit("ide_mkdir", { path: _livecodeBrowserPath, name: name.trim() });
};

window.selectLiveCodeProjectFromBrowser = function() {
  if (!_livecodeBrowserSelected) return;
  _livecodeSetBrowserLastPath(_livecodeBrowserSelected);
  closeLiveCodeProjectBrowser();
  setLiveCodeProject(_livecodeBrowserSelected);
};

window.toggleLiveCodeAgentPane = function(forceOpen) {

  const panel = document.getElementById("livecode-agent-panel");
  const divider = document.getElementById("ide-agent-divider");
  if (!panel) return;
  void forceOpen;
  panel.style.display = "flex";
  if (!window._livecodeAgentDefaultWidthApplied) {
    panel.style.width = "420px";
    window._livecodeAgentDefaultWidthApplied = true;
  }
  if (divider) divider.style.display = "block";
  _livecodeInitChatTabs();
  _livecodeBindChatScrollWheel();
  const out = getLiveCodeChatOutput();
  if (out) requestAnimationFrame(function() { out.scrollTop = out.scrollHeight; });
  if (window.ideEditor) {
    setTimeout(() => { try { window.ideEditor.layout(); } catch (e) {} }, 100);
  }
};

let _livecodeChatAbortController = null;
let _livecodeStatusRow = null;
let _livecodeStatusMsg = null;
let _livecodeCurrentUserRow = null;
let _livecodeAssistantStreamEl = null;
let _livecodeChatStarted = false;

function getLiveCodeChatOutput() {
  return document.getElementById("livecode-chat-messages");
}

function _livecodeTruncateTabTitle(text, maxLen) {
  let t = String(text || "");
  try {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = t;
    t = decoder.value || t;
  } catch (e) {}
  t = t
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_#>\[\](){}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "New chat";
  maxLen = maxLen || 28;
  return t.length <= maxLen ? t : t.slice(0, maxLen - 1).trimEnd() + "\u2026";
}

function _livecodeNormalizeProjectKey(path) {
  if (!path) return "";
  return String(path).replace(/\\/g, "/").replace(/\/+$/, "");
}

function _livecodeSnapshotTab(tab) {
  if (!tab) return null;
  return {
    id: tab.id,
    title: tab.title,
    sessionId: tab.sessionId,
    messagesHtml: tab.messagesHtml,
    chatStarted: !!tab.chatStarted,
    planFile: tab.planFile || "",
  };
}

function _livecodeSaveTabsForProject(path) {
  const key = _livecodeNormalizeProjectKey(path);
  if (!key) return;
  _livecodeSaveActiveChatTabState();
  livecodeTabsByProject[key] = {
    tabs: livecodeChatTabs.map(_livecodeSnapshotTab),
    activeTabId: livecodeActiveChatTabId,
    tabCounter: livecodeChatTabCounter,
  };
  _livecodePersistTabsStorage(path);
  livecodeChatTabs.forEach(function(tab) {
    if (tab.messagesHtml && tab.sessionId) {
      _livecodePersistChatSnapshot(path, tab);
    }
  });
}

function _livecodeLoadTabsForProject(path) {
  const key = _livecodeNormalizeProjectKey(path);
  let saved = livecodeTabsByProject[key];
  if (!saved || !saved.tabs || !saved.tabs.length) {
    saved = _livecodeLoadTabsStorage(path);
  }
  if (saved && saved.tabs && saved.tabs.length) {
    livecodeChatTabs = saved.tabs.map(function(t) {
      let title = t.title || "New chat";
      let messagesHtml = t.messagesHtml || "";
      if (!messagesHtml && t.chatStarted && t.sessionId) {
        const snap = _livecodeLoadChatSnapshot(path, t.sessionId);
        if (snap && snap.messagesHtml) {
          messagesHtml = snap.messagesHtml;
          if (snap.title) title = snap.title;
        }
      }
      return {
        id: t.id,
        title: title,
        sessionId: t.sessionId,
        messagesHtml: messagesHtml,
        chatStarted: !!(t.chatStarted && t.sessionId),
        planFile: t.planFile || "",
        abortController: null,
        agentRunning: false,
        hasUnread: false,
      };
    });
    livecodeActiveChatTabId = saved.activeTabId || livecodeChatTabs[0].id;
    livecodeChatTabCounter = saved.tabCounter || livecodeChatTabs.length;
  } else {
    const storedSessionId = _livecodeLoadSessionForProject(path);
    if (storedSessionId) {
      livecodeChatTabCounter = 1;
      const tab = {
        id: "chat-1",
        title: "New chat",
        sessionId: storedSessionId,
        messagesHtml: "",
        chatStarted: true,
        abortController: null,
        agentRunning: false,
        hasUnread: false,
      };
      livecodeChatTabs = [tab];
      livecodeActiveChatTabId = tab.id;
    } else {
      livecodeChatTabs = [];
      livecodeActiveChatTabId = null;
      livecodeChatTabCounter = 0;
      livecodeAgentSessionId = null;
      _livecodeInitChatTabs();
    }
  }
  const activeTab = _livecodeGetActiveChatTab();
  if (activeTab) {
    livecodeAgentSessionId = activeTab.sessionId || _livecodeNewChatSessionId();
    activeTab.sessionId = livecodeAgentSessionId;
    if (activeTab.chatStarted && activeTab.sessionId) {
      if (activeTab.agentRunning) {
        _livecodeLoadChatTabState(activeTab);
      } else if (activeTab.messagesHtml && String(activeTab.messagesHtml).trim()) {

        _livecodeLoadChatTabState(activeTab);
        _livecodeFetchSessionIntoTab(activeTab, activeTab.sessionId, { forceServer: true, silent: true });
      } else {
        _livecodeFetchSessionIntoTab(activeTab, activeTab.sessionId, { forceServer: true });
      }
    } else {
      _livecodeLoadChatTabState(activeTab);
    }
  } else {
    livecodeAgentSessionId = _livecodeNewChatSessionId();
  }
  _livecodeRenderChatTabs();
  _livecodeSyncGlobalRunningFromActiveTab();
}

function _livecodeSyncTabStreamOutput(tab) {
  if (!tab) return;
  if (tab.id === livecodeActiveChatTabId) {
    const out = getLiveCodeChatOutput();
    if (out) tab.messagesHtml = out.innerHTML;
  } else if (tab._backgroundOutput) {
    tab.messagesHtml = tab._backgroundOutput.innerHTML;
  }
}

function _livecodePrepareTabStreamBackground(tab) {

  if (!tab || !tab.agentRunning) return;
  if (tab.id !== livecodeActiveChatTabId) return;
  const out = getLiveCodeChatOutput();
  if (!out) return;
  if (!_livecodeChatOutputBelongsToTab(out, tab)) return;

  const cloned = out.cloneNode(true);
  const tmp = document.createElement("div");
  tmp.innerHTML = cloned.innerHTML;

  tab.messagesHtml = tmp.innerHTML;
  tab._backgroundOutput = tmp;
  _livecodeSyncTurnPointersFromOutput(tmp, tab);
}

function _livecodeEnsureBackgroundOutput(tab) {

  if (!tab) return null;
  if (tab.id === livecodeActiveChatTabId) {
    return getLiveCodeChatOutput();
  }
  if (!tab._backgroundOutput) {
    tab._backgroundOutput = document.createElement("div");
    tab._backgroundOutput.innerHTML = tab.messagesHtml || "";
  }
  return tab._backgroundOutput;
}

function _livecodeGetOutputForTab(tab) {
  if (!tab) return getLiveCodeChatOutput();
  if (tab.id === livecodeActiveChatTabId) {
    if (tab._backgroundOutput) {
      const live = getLiveCodeChatOutput();
      if (live) live.innerHTML = tab._backgroundOutput.innerHTML;
      tab._backgroundOutput = null;
    }
    return getLiveCodeChatOutput();
  }
  return _livecodeEnsureBackgroundOutput(tab);
}

function _livecodeGetOutputForSession(sessionId) {
  const tab = livecodeChatTabs.find(function(t) { return t.sessionId === sessionId; });
  return tab ? _livecodeGetOutputForTab(tab) : null;
}

function _livecodeGetTabStreamOutput(tab) {
  return _livecodeGetOutputForTab(tab);
}

function _livecodeAbortTabTurn(tab, options) {
  const opts = options || {};
  if (!tab) return;
  if (tab.abortController) {
    try {
      tab.abortController.abort();
    } catch (e) {}
    tab.abortController = null;
  }
  if (tab.agentRunning) {
    tab.agentRunning = false;
    if (opts.saveState !== false && tab.id === livecodeActiveChatTabId) {
      _livecodeSaveActiveChatTabState();
    }
  }
  if (tab.id === livecodeActiveChatTabId) {
    _livecodeChatAbortController = null;
    _livecodeClearPendingToolSteps();
  }
}

function _livecodeIsTabRunning(tab) {
  return !!(tab && tab.agentRunning);
}

function _livecodeGetRunningTab() {
  for (let i = 0; i < livecodeChatTabs.length; i++) {
    if (livecodeChatTabs[i].agentRunning) return livecodeChatTabs[i];
  }
  return null;
}

function _livecodeSyncGlobalRunningFromActiveTab() {
  const tab = _livecodeGetActiveChatTab();
  livecodeAgentRunning = _livecodeIsTabRunning(tab);
  _setLiveCodeChatBusy(livecodeAgentRunning);
}

function _livecodeNewChatSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return "livecode_" + window.crypto.randomUUID().replace(/-/g, "");
  }
  const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return "livecode_" + randomPart.replace(/[^a-z0-9]/g, "").padEnd(32, "0").slice(0, 32);
}

function _livecodeGetActiveChatTab() {
  return livecodeChatTabs.find(function(t) { return t.id === livecodeActiveChatTabId; }) || null;
}

function _livecodeSaveActiveChatTabState() {
  const tab = _livecodeGetActiveChatTab();
  if (!tab) return;
  const out = getLiveCodeChatOutput();
  if (out && !tab.agentRunning) {
    _livecodeFinalizeDomForSnapshot(out);
  }
  tab.messagesHtml = out ? out.innerHTML : "";
  tab.sessionId = livecodeAgentSessionId || tab.sessionId;
  tab.chatStarted = _livecodeChatStarted;
  if (livecodeProjectPath && tab.sessionId && _livecodeTabHasConversation(tab)) {
    _livecodeSaveSessionForProject(livecodeProjectPath, tab.sessionId);
    _livecodePersistChatSnapshot(livecodeProjectPath, tab);
  }
}

function _livecodeSyncTurnPointersFromOutput(out, tab) {
  if (!out) {
    _livecodeStatusRow = null;
    _livecodeStatusMsg = null;
    _livecodeCurrentUserRow = null;
    _livecodeAssistantStreamEl = null;
    if (tab) _livecodeSaveTurnCtxToTab(tab);
    return;
  }
  _livecodeStatusRow = out.querySelector("#livecode-agent-status-row");
  _livecodeStatusMsg = _livecodeStatusRow ? _livecodeStatusRow.querySelector(".livecode-status-msg") : null;
  const userRows = out.querySelectorAll(".livecode-user-row");
  _livecodeCurrentUserRow = userRows.length ? userRows[userRows.length - 1] : null;
  const streamRows = out.querySelectorAll(".livecode-assistant-row .livecode-stream-msg");
  _livecodeAssistantStreamEl = streamRows.length ? streamRows[streamRows.length - 1] : null;

  if (tab) {
    if (!(tab._assistantStreamRow && out.contains(tab._assistantStreamRow))) {
      tab._assistantStreamRow = null;
    }
  }
  const runningOuter = out.querySelector(".livecode-activity-wrap-outer.is-running");
  _livecodeRunningActivityEl = runningOuter || null;
  if (tab) _livecodeSaveTurnCtxToTab(tab);
}

function _livecodeSyncTurnPointersFromDom() {
  _livecodeSyncTurnPointersFromOutput(getLiveCodeChatOutput(), _livecodeGetActiveChatTab());
  _livecodeLastToolLabel = "";
  _livecodeLastTool = "";
  _livecodeLastToolArgs = {};
  _livecodeThinkingStartMs = null;
  _livecodePendingDurationS = null;
  _livecodeCancelThoughtStreamFlush();
  _livecodePendingThoughtContent = "";
  _livecodeStreamingThoughtContentEl = null;
  _livecodeStopThinkingTicker();
}

function _livecodeSanitizeLoadedActivityHtml(out) {
  if (!out) return;

  out.querySelectorAll(".is-running").forEach(function(el) {
    el.classList.remove("is-running");
  });
  out.querySelectorAll(".livecode-text-shimmer").forEach(function(el) {
    el.classList.remove("livecode-text-shimmer");
  });
  out.querySelectorAll(".livecode-activity-wrap-outer.is-running").forEach(function(el) {
    el.classList.remove("is-running");
  });
}

function _livecodeUpdateUserMessageCollapseState(out) {
  if (!out) return;
  Array.from(out.querySelectorAll(".chat-row.livecode-user-row")).forEach(function(row) {
    const msg = row.querySelector(".chat-msg.user");
    if (!msg) return;
    row.classList.remove("is-collapsible");
    const isExpanded = row.classList.contains("is-expanded");
    if (isExpanded) row.classList.remove("is-expanded");

    const styles = getComputedStyle(msg);
    let lineHeight = parseFloat(styles.lineHeight || "0");
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      const fontSize = parseFloat(styles.fontSize || "0");
      lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.55 : 18;
    }
    const collapsedHeight = lineHeight * 6.2;
    const isTooTallForCollapsedRange = msg.scrollHeight > collapsedHeight + 2;

    if (isExpanded) row.classList.add("is-expanded");
    if (isTooTallForCollapsedRange) {
      row.classList.add("is-collapsible");
    } else {
      row.classList.remove("is-expanded");
    }
  });
}

function _livecodeScheduleUserMessageCollapseState(out) {
  if (!out) return;
  requestAnimationFrame(function() {
    _livecodeUpdateUserMessageCollapseState(out);
  });
}

function _livecodeFinalizeDomForSnapshot(out) {
  if (!out) return;
  _livecodeSanitizeLoadedActivityHtml(out);
  _livecodeUpdateUserMessageCollapseState(out);
  Array.from(out.querySelectorAll(".livecode-agent-steps-row")).forEach(function(row) {
    if (!row.querySelector(".livecode-activity-wrap-outer")) {
      row.remove();
    }
  });
}

function _livecodeLoadChatTabState(tab) {
  if (!tab) return;
  if (!tab.messagesHtml && tab.chatStarted && tab.sessionId && livecodeProjectPath) {
    const snap = _livecodeLoadChatSnapshot(livecodeProjectPath, tab.sessionId);
    if (snap && snap.messagesHtml) {
      tab.messagesHtml = snap.messagesHtml;
      if (snap.title) tab.title = _livecodeTruncateTabTitle(snap.title);
    }
  }
  _livecodeResetTurnState();
  livecodeAgentSessionId = tab.sessionId || _livecodeNewChatSessionId();
  tab.sessionId = livecodeAgentSessionId;
  _livecodeChatStarted = !!tab.chatStarted;
  const out = getLiveCodeChatOutput();
  if (out) {
    _livecodeMarkChatOutputForTab(out, tab);
    out.innerHTML = tab.messagesHtml || "";
  }
  _livecodeStripStaleWelcome(out);
  _livecodeSanitizeLoadedActivityHtml(out);
  _livecodePostProcessRestoredOutput(out);
  _livecodeScheduleUserMessageCollapseState(out);
  _livecodeSyncTurnPointersFromDom();
  _livecodeSaveTurnCtxToTab(tab);
}

function _livecodeRenderChatTabs() {
  const list = document.getElementById("livecode-chat-tabs-list");
  if (!list) return;
  list.innerHTML = "";
  livecodeChatTabs.forEach(function(tab) {
    const tabEl = document.createElement("div");
    const runningClass = tab.agentRunning ? " is-running" : "";
    const unreadClass = tab.hasUnread && !tab.agentRunning ? " has-unread" : "";
    tabEl.className = "livecode-chat-tab theme-transition" + (tab.id === livecodeActiveChatTabId ? " active" : "") + runningClass + unreadClass;
    tabEl.dataset.tabId = tab.id;
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("tabindex", tab.id === livecodeActiveChatTabId ? "0" : "-1");
    tabEl.setAttribute("aria-selected", tab.id === livecodeActiveChatTabId ? "true" : "false");
    const tabTitle = _livecodeTruncateTabTitle(tab.title);
    tabEl.innerHTML =
      '<span class="livecode-chat-tab-icon">' + _livecodeGetTabIconHtml(tab) + "</span>" +
      '<span class="livecode-chat-tab-label" title="' + _livecodeEscapeHtml(tabTitle) + '">' + _livecodeEscapeHtml(tabTitle) + "</span>" +
      '<button type="button" class="livecode-chat-tab-close theme-transition" title="Close chat" aria-label="Close chat">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      "</button>";
    tabEl.addEventListener("click", function(e) {
      if (e.target.closest(".livecode-chat-tab-close")) return;
      _livecodeSwitchChatTab(tab.id);
    });
    const closeBtn = tabEl.querySelector(".livecode-chat-tab-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        _livecodeCloseChatTab(tab.id);
      });
    }
    list.appendChild(tabEl);
  });
}

function _livecodeSwitchChatTab(tabId) {
  if (!tabId || tabId === livecodeActiveChatTabId) return;
  const currentTab = _livecodeGetActiveChatTab();
  if (currentTab) {
    _livecodeSaveTurnCtxToTab(currentTab);
    _livecodeSyncTabStreamOutput(currentTab);
    if (!currentTab.agentRunning) {
      _livecodeSaveActiveChatTabState();
    }
    _livecodePrepareTabStreamBackground(currentTab);
  }
  const tab = livecodeChatTabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  livecodeActiveChatTabId = tabId;
  _livecodeClearTabUnread(tab);
  _livecodeLoadChatTabState(tab);
  if (livecodeProjectPath && tab.sessionId && _livecodeTabHasConversation(tab)) {
    _livecodeSaveSessionForProject(livecodeProjectPath, tab.sessionId);
  }
  if (tab.agentRunning && tab._backgroundOutput) {
    const out = getLiveCodeChatOutput();
    if (out) out.innerHTML = tab._backgroundOutput.innerHTML;
    tab._backgroundOutput = null;
  }
  _livecodeSyncTurnPointersFromDom();
  _livecodeSyncGlobalRunningFromActiveTab();
  _livecodeRenderChatTabs();
  const out = getLiveCodeChatOutput();
  if (out) requestAnimationFrame(function() { out.scrollTop = out.scrollHeight; });
  if (livecodeProjectPath) _livecodeSaveTabsForProject(livecodeProjectPath);
}

function _livecodeCloseChatTab(tabId) {
  const tabIndex = livecodeChatTabs.findIndex(function(t) { return t.id === tabId; });
  if (tabIndex === -1) return;
  const closingTab = livecodeChatTabs[tabIndex];
  const wasActive = livecodeActiveChatTabId === tabId;
  if (wasActive) {
    _livecodeSaveActiveChatTabState();
  }
  _livecodeAbortTabTurn(closingTab, { saveState: wasActive });
  if (livecodeChatTabs.length === 1) {
    const tab = livecodeChatTabs[0];
    tab.title = "New chat";
    tab.messagesHtml = "";
    tab.chatStarted = false;
    tab.sessionId = _livecodeNewChatSessionId();
    tab.hasUnread = false;
    _livecodeLoadChatTabState(tab);
    _livecodeSyncGlobalRunningFromActiveTab();
    _livecodeRenderChatTabs();
    if (livecodeProjectPath) _livecodeSaveTabsForProject(livecodeProjectPath);
    return;
  }
  livecodeChatTabs.splice(tabIndex, 1);
  if (wasActive) {
    const nextTab = livecodeChatTabs[Math.max(0, tabIndex - 1)];
    livecodeActiveChatTabId = nextTab.id;
    _livecodeLoadChatTabState(nextTab);
    _livecodeSyncGlobalRunningFromActiveTab();
  }
  _livecodeRenderChatTabs();
  if (livecodeProjectPath) _livecodeSaveTabsForProject(livecodeProjectPath);
}

function _livecodeCreateChatTab(title, options) {
  const opts = options || {};
  const currentTab = _livecodeGetActiveChatTab();
  if (currentTab && !opts.skipSave) {
    _livecodeSaveTurnCtxToTab(currentTab);
    _livecodeSyncTabStreamOutput(currentTab);
    _livecodeSaveActiveChatTabState();
    _livecodePrepareTabStreamBackground(currentTab);
  }
  const tabId = "chat-" + (++livecodeChatTabCounter);
  const tab = {
    id: tabId,
    title: title || "New chat",
    sessionId: _livecodeNewChatSessionId(),
    messagesHtml: "",
    chatStarted: false,
    abortController: null,
    agentRunning: false,
    hasUnread: false,
  };
  livecodeChatTabs.push(tab);
  if (opts.activate !== false) {
    livecodeActiveChatTabId = tabId;
    _livecodeClearTabUnread(tab);
    _livecodeLoadChatTabState(tab);
    _livecodeSyncGlobalRunningFromActiveTab();
  }
  _livecodeRenderChatTabs();
  if (livecodeProjectPath) _livecodeSaveTabsForProject(livecodeProjectPath);
  return tabId;
}

let _livecodeChatTabsBound = false;

function _livecodeBindChatTabControlsOnce() {
  if (_livecodeChatTabsBound) return;
  _livecodeChatTabsBound = true;
  const addBtn = document.getElementById("livecode-chat-tab-add");
  if (addBtn) {
    addBtn.addEventListener("click", function(e) {
      e.preventDefault();
      window.createLiveCodeChatTab();
    });
  }
  const historyBtn = document.getElementById("livecode-chat-session-history");
  if (historyBtn) {
    historyBtn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.toggleLiveCodeSessionMenu();
    });
  }
  const recentBtn = document.getElementById("ide-activity-recent");
  if (recentBtn && !recentBtn._livecodeProjectMenuBound) {
    recentBtn._livecodeProjectMenuBound = true;
    recentBtn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.toggleLiveCodeProjectMenu();
    });
  }
  const sessionMenu = document.getElementById("livecode-chat-session-menu");
  if (sessionMenu) {
    sessionMenu.addEventListener("click", function(e) { e.stopPropagation(); });
  }
  const projectMenu = document.getElementById("livecode-project-menu");
  if (projectMenu) {
    projectMenu.addEventListener("click", function(e) { e.stopPropagation(); });
  }
  if (!window._livecodeSessionMenuGlobalBound) {
    window._livecodeSessionMenuGlobalBound = true;
    document.addEventListener("click", function(e) {
      if (_livecodeSessionMenuOpen) {
        if (!e.target.closest("#livecode-chat-session-menu") &&
            !e.target.closest("#livecode-chat-session-history") &&
            !e.target.closest(".livecode-chat-session-item-menu")) {
          closeLiveCodeSessionMenu();
        }
      }
      if (_livecodeProjectMenuOpen) {
        if (!e.target.closest("#livecode-project-menu") &&
            !e.target.closest("#ide-activity-recent") &&
            !e.target.closest(".livecode-chat-session-item-menu")) {
          closeLiveCodeProjectMenu();
        }
      }
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        if (_livecodeSessionMenuOpen) closeLiveCodeSessionMenu();
        if (_livecodeProjectMenuOpen) closeLiveCodeProjectMenu();
      }
    });
  }
}

function _livecodeInitChatTabs() {
  _livecodeBindChatTabControlsOnce();
  if (livecodeChatTabs.length) return;
  const sessionId = livecodeProjectPath
    ? _livecodeNewChatSessionId()
    : (livecodeAgentSessionId || _livecodeNewChatSessionId());
  livecodeChatTabCounter += 1;
  const tab = {
    id: "chat-" + livecodeChatTabCounter,
    title: "New chat",
    sessionId: sessionId,
    messagesHtml: getLiveCodeChatOutput() ? getLiveCodeChatOutput().innerHTML : "",
    chatStarted: _livecodeChatStarted,
    abortController: null,
    agentRunning: false,
    hasUnread: false,
  };
  livecodeChatTabs.push(tab);
  livecodeActiveChatTabId = tab.id;
  livecodeAgentSessionId = sessionId;
  _livecodeRenderChatTabs();
}

function _livecodeUpdateActiveChatTabTitle(text, force) {
  const tab = _livecodeGetActiveChatTab();
  if (!tab) return;
  const nextTitle = _livecodeTruncateTabTitle(text);
  if (force || tab.title === "New chat" || !tab.title) {
    tab.title = nextTitle;
    _livecodeRenderChatTabs();
  }
}

window.createLiveCodeChatTab = function() {
  return _livecodeCreateChatTab("New chat");
};

window.switchLiveCodeChatTab = function(tabId) {
  _livecodeSwitchChatTab(tabId);
};

function _livecodeBindChatScrollWheel() {
  const out = getLiveCodeChatOutput();
  if (!out || out.dataset.wheelBound === "1") return;
  out.dataset.wheelBound = "1";
  out.addEventListener("wheel", function(e) {
    if (out.scrollHeight <= out.clientHeight + 1) return;
    const delta = e.deltaY;
    const atTop = out.scrollTop <= 0;
    const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 1;
    if ((delta < 0 && !atTop) || (delta > 0 && !atBottom)) {
      e.stopPropagation();
    }
  }, { passive: true, capture: true });
}

function _livecodeShowChatContainer() {
  _livecodeChatStarted = true;
}

function _livecodeIsPreservedChatRow(row) {
  if (!row) return true;
  if (row.classList.contains("livecode-user-row") ||
      row.classList.contains("livecode-assistant-row") ||
      row.classList.contains("livecode-agent-steps-row") ||
      row.classList.contains("livecode-status-row") ||
      row.classList.contains("livecode-diff-row") ||
      row.classList.contains("livecode-command-output") ||
      row.classList.contains("livecode-permission-row")) {
    return true;
  }

  if (row.querySelector(".livecode-diff-block, .livecode-code-card, .livecode-json-display-block, .livecode-table-display-block, .livecode-csv-display-block")) {
    return true;
  }
  return false;
}

function _livecodeChatOutputBelongsToTab(out, tab) {
  if (!out || !tab) return false;
  if (!tab.sessionId) return true;
  const domSessionId = out.dataset ? (out.dataset.livecodeSessionId || "") : "";

  return !!domSessionId && domSessionId === tab.sessionId;
}

function _livecodeMarkChatOutputForTab(out, tab) {
  if (!out || !out.dataset) return;
  if (tab && tab.sessionId) out.dataset.livecodeSessionId = tab.sessionId;
  else delete out.dataset.livecodeSessionId;
}

function _livecodeSyncActiveTabMessagesHtml() {
  const tab = _livecodeGetActiveChatTab();
  const out = getLiveCodeChatOutput();
  if (tab && out && tab.id === livecodeActiveChatTabId && _livecodeChatOutputBelongsToTab(out, tab)) {
    tab.messagesHtml = out.innerHTML;
    if (livecodeProjectPath && tab.sessionId && tab.messagesHtml) {
      _livecodePersistChatSnapshot(livecodeProjectPath, tab);
    }
  }
}

function _livecodeClearWelcomePlaceholder(out) {
  if (!out) return;
  Array.from(out.querySelectorAll(":scope > .chat-row")).forEach(function(row) {
    if (_livecodeIsPreservedChatRow(row)) return;
    if (row.querySelector(".livecode-plain-msg")) row.remove();
  });
}

function _livecodeStripStaleWelcome(out) {
  if (!out || !out.querySelector(".livecode-user-row")) return;
  _livecodeClearWelcomePlaceholder(out);
}

function _livecodeScrollChatToBottom(out) {
  if (!out) return;
  out.scrollTop = out.scrollHeight;
  requestAnimationFrame(function() {
    try { out.scrollTop = out.scrollHeight; } catch (e) {}
  });
}

function _livecodeUpdateChatWelcome() {
  const out = getLiveCodeChatOutput();
  if (!out || _livecodeChatStarted) return;
  if (!livecodeProjectPath) {
    out.innerHTML = '<div class="chat-row"><div class="chat-msg assistant livecode-plain-msg" style="opacity:0.8;">Open a project folder to start chatting with the LiveCode agent.</div></div>';
    return;
  }
  out.innerHTML = '<div class="chat-row"><div class="chat-msg assistant livecode-plain-msg" style="opacity:0.8;">Ask about your codebase — search, read, edit, and run commands.</div></div>';
}

function _setLiveCodeChatBusy(busy) {
  document.querySelectorAll('.chatbot-composer[data-sidebar-section="livecode"]').forEach(function(el) {
    el.classList.toggle("is-llm-answering", busy);
    var stop = el.querySelector(".chatbot-composer-stop-btn");
    var send = el.querySelector(".chatbot-composer-send-btn");
    var spin = el.querySelector(".chatbot-composer-spinner");
    if (stop) stop.style.display = busy ? "inline-flex" : "";
    if (send) send.style.display = busy ? "none" : "";
    if (spin) spin.style.display = busy ? "none" : "";
  });
}

function _livecodeIsGenericStatusMessage(msg) {
  const t = String(msg || "").trim();
  return !t || /^Working/i.test(t) || /^Explored project/i.test(t);
}

function _livecodeStripUserQueryWrapper(text) {
  var s = String(text || "").trim();
  if (!s) return "";
  var m = s.match(/^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/i);
  return m ? m[1].trim() : s;
}

function _livecodeStripAttachedFileBlocks(text) {
  var s = _livecodeStripUserQueryWrapper(text);
  if (!s) return "";
  s = s.replace(/\n--- File:[\s\S]*?--- End of[^\n]+ ---/g, "").trim();
  s = s.replace(/\nAttached file content:[\s\S]*/g, "").trim();
  s = s.replace(/\nAttached binary file[^\n]*[\s\S]*/g, "").trim();
  s = s.replace(/\nAttached image file[^\n]*[\s\S]*/g, "").trim();
  return s.trim();
}

function _livecodeShouldSkipMarkdownRehydrate(el) {
  if (!el) return true;
  if (el.closest(".livecode-diff-row, .livecode-command-output")) return true;
  if (el.querySelector(".livecode-diff-block, .livecode-code-card, .livecode-json-display-block, .livecode-csv-display-block, .livecode-table-display-block")) {
    return true;
  }
  return false;
}

function _livecodeEscapeHtml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let _livecodeCommandStreamHandler = null;

function parseLivecodeOpenSectionsList() {
  var raw = localStorage.getItem("livecode-open-sections");
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

window.livecodeRecordToolOpen = window.livecodeRecordToolOpen || function() {};

window.livecodeCommandHeaderLabel = function(cmd) {
  const raw = String(cmd || "").trim();
  if (!raw) return "shell";
  let segment = raw.split(/&&|\|\||;/)[0].trim();
  segment = segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/, "");
  if (/^cd\s+/i.test(segment) && /(?:&&|\|\||;)/.test(raw)) {
    const tail = raw.split(/&&|\|\||;/).pop();
    if (tail) segment = String(tail).trim();
  }
  const parts = segment.split(/\s+/).filter(Boolean);
  if (!parts.length) return "shell";
  const skip = { sudo: 1, time: 1, nohup: 1, env: 1, command: 1 };
  let i = 0;
  while (i < parts.length && skip[String(parts[i]).toLowerCase()]) i++;
  if (i >= parts.length) return parts[0];
  return parts[i];
};

function _livecodeSanitizeCommandOutput(text) {
  const lines = String(text || "").split(/\r?\n/);
  const filtered = lines.filter(function(line) {
    const s = line.trim();
    if (!s) return true;
    if (/^exit\s*[-:]?\s*\d+$/i.test(s)) return false;
    if (/^(passed|pass|ok|success)$/i.test(s)) return false;
    return true;
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function _livecodeCreateCopyCodeButton(codeEl) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-code-btn";
  btn.title = "Copy code";
  btn.setAttribute("aria-label", "Copy code");
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  btn.addEventListener("click", function() {
    try {
      const text = codeEl.innerText || codeEl.textContent || "";
      navigator.clipboard.writeText(text).then(function() {
        const old = btn.innerHTML;
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(function() { btn.innerHTML = old; }, 1200);
      });
    } catch (e) {}
  });
  return btn;
}

function _livecodeHighlightCommandCode(codeEl) {
  if (!codeEl) return;
  try {
    if (typeof hljs !== "undefined") {
      codeEl.className = "language-bash";
      if (hljs.getLanguage("bash")) hljs.highlightElement(codeEl);
    }
  } catch (e) {}
}

window.livecodeBuildRestoredCommandRow = window.livecodeBuildRestoredCommandRow || function(command, outputText, exitCode) {
  var cmd = String(command || "").trim();
  var text = _livecodeSanitizeCommandOutput(outputText);
  var row = document.createElement("div");
  row.className = "chat-row livecode-command-output";
  if (cmd) row.dataset.commandFull = cmd;

  var msg = document.createElement("div");
  msg.className = "chat-msg assistant livecode-plain-msg";

  var card = document.createElement("div");
  card.className = "code-card livecode-code-card";

  var header = document.createElement("div");
  header.className = "code-card-header";
  var langSpan = document.createElement("span");
  langSpan.className = "lang";
  langSpan.textContent = "bash";

  var cmdPre = document.createElement("pre");
  cmdPre.className = "livecode-code-block livecode-command-input-block";
  var cmdCode = document.createElement("code");
  cmdCode.className = "language-bash";
  cmdCode.textContent = cmd || "shell";
  cmdPre.appendChild(cmdCode);

  header.appendChild(langSpan);
  header.appendChild(_livecodeCreateCopyCodeButton(cmdCode));
  card.appendChild(header);
  card.appendChild(cmdPre);

  if (text) {
    var outPre = document.createElement("pre");
    outPre.className = "livecode-code-block livecode-command-output-block";
    var outCode = document.createElement("code");
    outCode.className = "monaco-enhanced";
    outCode.textContent = text;
    outPre.appendChild(outCode);
    card.appendChild(outPre);
  }

  _livecodeHighlightCommandCode(cmdCode);
  msg.appendChild(card);
  row.appendChild(msg);
  return row;
};

window.livecodeChatWaitingMarkup = window.livecodeChatWaitingMarkup || function() {
  return '<div class="livecode-chat-waiting" aria-busy="true"><span class="livecode-chat-wait-dot"></span><span class="livecode-chat-wait-dot"></span><span class="livecode-chat-wait-dot"></span></div>';
};

window.mountLivecodeChatMarkdown = window.mountLivecodeChatMarkdown || function(el, text) {
  _livecodeRenderAssistantMarkdown(el, text || "");
};

window.rehydrateLivecodeChatMarkdown = window.rehydrateLivecodeChatMarkdown || function(out) {
  if (!out) return;
  out.querySelectorAll(".livecode-assistant-row .livecode-plain-msg").forEach(function(el) {
    if (_livecodeShouldSkipMarkdownRehydrate(el)) return;
    var raw = el.getAttribute("data-raw-md");
    if (!raw) return;
    window.mountLivecodeChatMarkdown(el, raw);
  });
};

window.livecodeCreateCommandStreamHandler = window.livecodeCreateCommandStreamHandler || function(config) {
  config = config || {};
  var state = { rows: {} };
  function handler(data) {
    if (!config.shouldHandle || !config.shouldHandle(data)) return;
    var output = config.getOutput ? config.getOutput() : null;
    if (!output) return;
    var key = String((data && data.command_index) || 1);
    var status = String((data && data.status) || "");
    if (status === "start") {
      if (config.onCommandStart) config.onCommandStart(data);
      var existing = _livecodeFindCommandOutputRow(output, data.command || "");
      if (existing) {
        state.rows[key] = existing;
        return;
      }
      if (state.rows[key] && state.rows[key].isConnected) return;
      var row = window.livecodeBuildRestoredCommandRow(data.command || "", "", null);
      row.dataset.commandKey = key;
      state.rows[key] = row;
      if (config.appendRow) config.appendRow(output, row);
      return;
    }
    var rowRef = state.rows[key];
    if (!rowRef) return;
    if (status === "stream") {
      var chunk = String(data.output || "");
      if (!chunk) return;
      var streamEl = _livecodeEnsureCommandOutputBlock(rowRef);
      if (streamEl) {
        if (streamEl.parentElement) streamEl.parentElement.style.display = "";
        streamEl.textContent += chunk;
      }
    } else if (status === "output") {
      _livecodeSetCommandOutputBlock(rowRef, data.output || "");
      _livecodeRemoveEmptyDuplicateCommandRows(output, data.command || "", rowRef);
      delete state.rows[key];
      if (config.onCommandsComplete) config.onCommandsComplete(data);
    }
  }
  handler.reset = function() { state.rows = {}; };
  return handler;
};

function _livecodeEnsureCommandStreamHandler() {
  if (_livecodeCommandStreamHandler || typeof window.livecodeCreateCommandStreamHandler !== "function") return;
  _livecodeCommandStreamHandler = window.livecodeCreateCommandStreamHandler({
    classPrefix: "livecode",
    getOutput: function() {
      if (!_livecodeCommandStreamTab) return null;
      return _livecodeGetOutputForTab(_livecodeCommandStreamTab);
    },
    appendRow: function(output, row) {
      _livecodeAppendChatRow(output, row, _livecodeCommandStreamTab);
    },
    shouldHandle: function(data) {
      _livecodeCommandStreamTab = null;
      if (!data || data.source !== "livecode" || !data.session_id) return false;
      const targetTab = livecodeChatTabs.find(function(t) {
        return t.sessionId === data.session_id && t.agentRunning;
      });
      if (!targetTab) return false;
      if (targetTab._answerStreaming || targetTab._turnStreamComplete) return false;
      const out = _livecodeGetOutputForTab(targetTab);
      if (!out) return false;
      if (targetTab.id === livecodeActiveChatTabId &&
          !_livecodeChatOutputBelongsToTab(getLiveCodeChatOutput(), targetTab)) {
        return false;
      }
      _livecodeCommandStreamTab = targetTab;
      return true;
    },
    onCommandStart: function() {
      _livecodeHideStatusRow();
    },
    onCommandsComplete: function() {
      if (_livecodeCommandStreamTab) {
        _livecodeSyncTabStreamOutput(_livecodeCommandStreamTab);
        if (_livecodeCommandStreamTab.id !== livecodeActiveChatTabId) {
          _livecodeCommandStreamTab.hasUnread = true;
          _livecodeRenderChatTabs();
        }
        _livecodeCommandStreamTab = null;
      }
      _livecodeSyncActiveTabMessagesHtml();
    }
  });
}

function _livecodeTypingMarkup() {
  return typeof window.livecodeChatWaitingMarkup === "function"
    ? window.livecodeChatWaitingMarkup()
    : '<div class="livecode-chat-waiting" aria-busy="true"><span class="livecode-chat-wait-dot"></span><span class="livecode-chat-wait-dot"></span><span class="livecode-chat-wait-dot"></span></div>';
}

function _livecodeGetAgentStepsRow(output) {
  output = output || getLiveCodeChatOutput();
  if (!output) return null;
  const rows = Array.from(output.querySelectorAll(".chat-row"));
  if (!rows.length) return null;
  const startIdx = _livecodeCurrentUserRow ? rows.indexOf(_livecodeCurrentUserRow) : -1;

  let lastIdx = rows.length - 1;
  while (lastIdx >= 0 && rows[lastIdx].classList.contains("livecode-assistant-row")) {
    lastIdx -= 1;
  }
  if (lastIdx < 0) return null;
  const lastRow = rows[lastIdx];
  if (!lastRow.classList.contains("livecode-agent-steps-row")) return null;
  return lastIdx > startIdx ? lastRow : null;
}

function _livecodeGetAssistantAnchor(output, tab) {

  if (!output) return null;
  const t = tab || _livecodeGetActiveChatTab();
  if (t && t._assistantStreamRow && output.contains(t._assistantStreamRow)) {
    return t._assistantStreamRow;
  }
  return null;
}

function _livecodeAppendChatRow(output, row, tab) {
  if (!output || !row) return;
  const anchor = _livecodeGetAssistantAnchor(output, tab);
  if (anchor && anchor.parentNode === output) {
    output.insertBefore(row, anchor);
  } else {
    const statusRow = output.querySelector(".livecode-status-row, .livecode-status-row");
    if (statusRow && statusRow.parentNode === output) {
      output.insertBefore(row, statusRow);
    } else {
      output.appendChild(row);
    }
  }
}

function _livecodeEnsureAgentStepsRow(output) {
  output = output || getLiveCodeChatOutput();
  if (!output) return null;
  let stepsRow = _livecodeGetAgentStepsRow(output);
  if (!stepsRow) {
    stepsRow = document.createElement("div");
    stepsRow.className = "chat-row livecode-agent-steps-row";
    stepsRow.innerHTML = '<div class="chat-msg assistant livecode-agent-steps"></div>';
    _livecodeAppendChatRow(output, stepsRow);
  }
  return stepsRow.querySelector(".livecode-agent-steps");
}

let _livecodeLastToolLabel = "";
let _livecodeLastTool = "";
let _livecodeLastToolArgs = {};
let _livecodeRunningActivityEl = null;
let _livecodeThinkingStartMs = null;
let _livecodePendingDurationS = null;
let _livecodePendingThoughtContent = "";
let _livecodeStreamingThoughtContentEl = null;
let _livecodeThinkingTicker = null;
let _livecodeThoughtStreamFlushTimer = null;
let _livecodeLastProgressSeqBySession = {};
let _livecodeActiveTurnIdBySession = {};
const _LIVECODE_MAX_THOUGHT_CHARS = 6000;
const _LIVECODE_THOUGHT_STREAM_FLUSH_MS = 200;
let _livecodeCommandStreamTab = null;

function _livecodeCreateTurnCtx() {
  return {
    currentUserRow: null,
    assistantStreamEl: null,
    statusRow: null,
    statusMsg: null,
    runningActivityEl: null,
    lastToolLabel: "",
    lastTool: "",
    lastToolArgs: {},
    thinkingStartMs: null,
    pendingDurationS: null,
    pendingThoughtContent: "",
    streamingThoughtContentEl: null,
  };
}

function _livecodeSaveTurnCtxToTab(tab) {
  if (!tab) return;
  if (!tab._turnCtx) tab._turnCtx = _livecodeCreateTurnCtx();
  const ctx = tab._turnCtx;
  ctx.currentUserRow = _livecodeCurrentUserRow;
  ctx.assistantStreamEl = _livecodeAssistantStreamEl;
  ctx.statusRow = _livecodeStatusRow;
  ctx.statusMsg = _livecodeStatusMsg;
  ctx.runningActivityEl = _livecodeRunningActivityEl;
  ctx.lastToolLabel = _livecodeLastToolLabel;
  ctx.lastTool = _livecodeLastTool;
  ctx.lastToolArgs = _livecodeLastToolArgs;
  ctx.thinkingStartMs = _livecodeThinkingStartMs;
  ctx.pendingDurationS = _livecodePendingDurationS;
  ctx.pendingThoughtContent = _livecodePendingThoughtContent;
  ctx.streamingThoughtContentEl = _livecodeStreamingThoughtContentEl;
}

function _livecodeLoadTurnCtxFromTab(tab) {
  if (!tab || !tab._turnCtx) {
    _livecodeResetTurnState();
    return;
  }
  const ctx = tab._turnCtx;
  _livecodeCurrentUserRow = ctx.currentUserRow;
  _livecodeAssistantStreamEl = ctx.assistantStreamEl;
  _livecodeStatusRow = ctx.statusRow;
  _livecodeStatusMsg = ctx.statusMsg;
  _livecodeRunningActivityEl = ctx.runningActivityEl;
  _livecodeLastToolLabel = ctx.lastToolLabel;
  _livecodeLastTool = ctx.lastTool;
  _livecodeLastToolArgs = ctx.lastToolArgs;
  _livecodeThinkingStartMs = ctx.thinkingStartMs;
  _livecodePendingDurationS = ctx.pendingDurationS;
  _livecodePendingThoughtContent = ctx.pendingThoughtContent;
  _livecodeStreamingThoughtContentEl = ctx.streamingThoughtContentEl;
}

function _livecodeWithTabContext(tab, fn) {
  const activeTab = _livecodeGetActiveChatTab();
  const isActive = tab && activeTab && tab.id === activeTab.id;
  if (!isActive && activeTab) {
    _livecodeSaveTurnCtxToTab(activeTab);
  }
  if (tab) {
    if (!isActive) {
      const tabOutput = _livecodeGetOutputForTab(tab);
      if (tabOutput) _livecodeSyncTurnPointersFromOutput(tabOutput, tab);
    } else {
      const liveOut = getLiveCodeChatOutput();
      if (liveOut) _livecodeResolveRunningActivityEl(liveOut);
    }
    _livecodeLoadTurnCtxFromTab(tab);
    if (isActive) {
      const liveOut = getLiveCodeChatOutput();
      if (liveOut) _livecodeResolveRunningActivityEl(liveOut);
    }
  }
  try {
    return fn();
  } finally {
    if (tab) _livecodeSaveTurnCtxToTab(tab);
    if (!isActive && activeTab) {
      _livecodeLoadTurnCtxFromTab(activeTab);
    }
  }
}

function _livecodeFindRunningActivityWrap(output) {
  output = output || getLiveCodeChatOutput();
  if (!output) return null;
  const stepsContainer = _livecodeGetAgentStepsRow(output);
  if (!stepsContainer) return null;
  const outers = stepsContainer.querySelectorAll(".livecode-activity-wrap-outer.is-running");
  return outers.length ? outers[outers.length - 1] : null;
}

function _livecodeResolveRunningActivityEl(output) {
  output = output || getLiveCodeChatOutput();
  if (_livecodeRunningActivityEl && output && output.contains(_livecodeRunningActivityEl)) {
    return _livecodeRunningActivityEl;
  }
  const found = _livecodeFindRunningActivityWrap(output);
  if (found) _livecodeRunningActivityEl = found;
  return _livecodeRunningActivityEl;
}

function _livecodeCleanupStaleThinkingLines(output, keepWrap) {
  output = output || getLiveCodeChatOutput();
  const stepsContainer = _livecodeGetAgentStepsRow(output);
  if (!stepsContainer) return;
  stepsContainer.querySelectorAll(".livecode-activity-wrap-outer.is-running").forEach(function(outer) {
    if (outer === keepWrap) return;
    const text = outer.querySelector(".livecode-activity-text");
    const label = String(text && text.textContent ? text.textContent : "").trim();
    if (/^Thinking\b/i.test(label)) outer.remove();
  });
}

function _livecodeComputeThoughtDuration() {
  if (!_livecodeThinkingStartMs) return 1;
  return Math.max(1, Math.round((Date.now() - _livecodeThinkingStartMs) / 1000));
}

function _livecodeIsThinkingLine() {
  return _livecodeLastTool === "attempt_completion" && /^thinking\b/i.test(String(_livecodeLastToolLabel || "").trim());
}

function _livecodeStopThinkingTicker() {
  if (_livecodeThinkingTicker) {
    clearInterval(_livecodeThinkingTicker);
    _livecodeThinkingTicker = null;
  }
}

function _livecodeUpdateThinkingLineLabel() {
  _livecodeResolveRunningActivityEl();
  if (!_livecodeRunningActivityEl || !_livecodeIsThinkingLine()) return;
  const secs = _livecodeComputeThoughtDuration();
  const textEl = _livecodeRunningActivityEl.querySelector(".livecode-activity-text");
  if (!textEl) return;

  textEl.textContent = secs > 1 ? ("Thinking " + secs + "s") : "Thinking";
}

function _livecodeStartThinkingTicker() {
  _livecodeStopThinkingTicker();
  _livecodeUpdateThinkingLineLabel();
  _livecodeThinkingTicker = setInterval(function() {
    if (!_livecodeRunningActivityEl || !_livecodeIsThinkingLine() || !livecodeAgentRunning) {
      _livecodeStopThinkingTicker();
      return;
    }
    _livecodeUpdateThinkingLineLabel();
  }, 1000);
}

function _livecodeThoughtParts() {
  const durationS = _livecodePendingDurationS || _livecodeComputeThoughtDuration();
  return {
    verb: "thought",
    detail: durationS + "s",
    meta: "",
    thoughtContent: String(_livecodePendingThoughtContent || "").trim(),
  };
}

function _livecodeThoughtDurationLabel(parts) {
  const p = parts || {};
  let secs = "";
  if (p.detail) {
    const m = String(p.detail).match(/^(\d+)s$/i) || String(p.detail).match(/for\s+(\d+)s/i);
    if (m) secs = m[1] + "s";
  }
  if (!secs) {
    const d = _livecodePendingDurationS || _livecodeComputeThoughtDuration();
    secs = d + "s";
  }
  return "Thought " + secs;
}

function _livecodeBriefThoughtLine(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  if (/\n\s*\n/.test(raw) || /^#{1,6}\s/m.test(raw) || raw.length > 400) {
    return "";
  }
  const lines = raw.split(/\r?\n/);
  let line = "";
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || "").replace(/\s+/g, " ").trim();
    if (t) {
      line = t;
      break;
    }
  }
  if (!line) return "";
  if (line.length > 160) return line.slice(0, 159).trimEnd() + "…";
  return line;
}

function _livecodeSubagentSummary(goal) {
  const g = String(goal || "").trim();
  if (!g) return "";
  const first = g.split(/\s+/)[0] || "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function _livecodeBasename(path) {
  if (!path) return "";
  const p = String(path).replace(/\\/g, "/");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function _livecodeResolveProjectFilePath(filePath) {
  let p = String(filePath || "").trim().replace(/\\/g, "/");
  if (!p) return "";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return p;
  if (!livecodeProjectPath) return p;
  let base = String(livecodeProjectPath).replace(/\\/g, "/");
  if (base.length > 1 && base.endsWith("/")) base = base.slice(0, -1);
  const rel = p.replace(/^\.?\//, "");
  return base + "/" + rel;
}

function _livecodeFileActivityParts(verb, filePath, meta) {
  const detail = _livecodeBasename(filePath) || String(filePath || "").trim();
  const parts = { verb: verb, detail: detail, meta: meta || "" };
  const abs = _livecodeResolveProjectFilePath(filePath);
  if (abs) parts.detailFilePath = abs;
  return parts;
}

function _livecodeIsFileEditTool(tool) {
  const t = String(tool || "").toLowerCase();
  return t === "edit_file" || t === "write_file";
}

function _livecodeEditLabelForKind(errorKind, errMsg) {
  const kind = String(errorKind || "").trim();
  const map = {
    multiple_matches: "Multiple matches found",
    no_matches: "No matches found",
    file_not_found: "File not found",
    invalid_input: "Invalid input",
  };

  const msg = String(errMsg || "").trim();
  if (kind === "file_not_found") return "File not found";
  if (kind === "invalid_input" && /missing required argument:\s*file_path/i.test(msg)) {
    return "Missing file path";
  }
  if (kind && map[kind]) return map[kind];
  if (/found multiple times/i.test(msg)) return "Multiple matches found";
  if (/not found in the file/i.test(msg)) return "No matches found";
  if (/^File not found:/i.test(msg)) return "File not found";
  if (/old string and new string are the same/i.test(msg)) return "Invalid input";
  return "Edit failed";
}

function _livecodeEditFailedParts(args, message, errorKind) {
  const a = args || {};
  const fp = _livecodeBasename(a.file_path) || "";
  const errMsg = String(message || "").trim();
  const kindStr = String(errorKind || "").trim();
  const parts = {
    verb: _livecodeEditLabelForKind(kindStr, errMsg),
    detail: fp || errMsg,
    meta: "",
    fullErrorTitle: errMsg,
    isError: true,

    // Don't surface common, user-fixable input mistakes as noisy "error" rows in the UI.
    // They can still be inspected via hover (fullErrorTitle) if needed.
    suppressActivity: [
      "no_matches",
      "multiple_matches",
      "file_not_found",
      "invalid_input",
    ].includes(kindStr),
  };
  if (a.file_path) {
    const abs = _livecodeResolveProjectFilePath(a.file_path);
    if (abs) parts.detailFilePath = abs;
  }
  return parts;
}

function _livecodeClearTransientEditFailure(filePath, stepsContainer) {
  if (!stepsContainer || !filePath) return;
  const base = _livecodeBasename(filePath);
  const abs = _livecodeResolveProjectFilePath(filePath);
  const outers = Array.from(stepsContainer.querySelectorAll(".livecode-activity-wrap-outer"));
  if (!outers.length) return;

  for (let i = outers.length - 1; i >= 0; i--) {
    const outer = outers[i];
    if (outer.classList.contains("is-running")) continue;
    const line = outer.querySelector(".livecode-activity-line.is-error");
    if (!line) continue;
    const detail = outer.querySelector(".livecode-activity-detail");
    if (!detail) continue;
    const text = (detail.textContent || "").trim();
    const linkedPath = outer.querySelector("[data-file-path]");
    const detailPath = linkedPath ? String(linkedPath.getAttribute("data-file-path") || "") : "";
    if (text === base || (abs && detailPath === abs)) {
      outer.remove();
      return;
    }
  }
}

function _livecodeRecordEditFailure(args, message, errorKind, output) {
  output = output || getLiveCodeChatOutput();
  const stepsContainer = _livecodeEnsureAgentStepsRow(output);
  if (!stepsContainer) return null;
  const parts = _livecodeEditFailedParts(args, message, errorKind);

  if (_livecodeRunningActivityEl) {
    _livecodeStopThinkingTicker();
    _livecodeRunningActivityEl.remove();
    _livecodeRunningActivityEl = null;
    _livecodePendingDurationS = null;
    _livecodeCancelThoughtStreamFlush();
    _livecodePendingThoughtContent = "";
    _livecodeStreamingThoughtContentEl = null;
    _livecodeThinkingStartMs = null;
  }
  if (!parts.suppressActivity) {
    _livecodeAppendActivityParts(parts, false, output);
    if (output) output.scrollTop = output.scrollHeight;
  }
  return parts;
}

function _livecodeTruncateMiddle(str, maxLen) {
  const s = String(str || "");
  const n = Math.max(0, maxLen | 0);
  if (!n || s.length <= n) return s;
  if (n <= 1) return "…";
  const head = Math.ceil((n - 1) / 2);
  const tail = Math.floor((n - 1) / 2);
  return s.slice(0, head) + "…" + s.slice(s.length - tail);
}

function _livecodeParseActivityParts(tool, args, message) {
  const a = args || {};
  const msg = String(message || "").trim();
  const t = String(tool || "").toLowerCase();

  if (t === "grep_repo" || msg.startsWith("Grepped")) {
    const gm = msg.match(/Grepped\s+`([^`]+)`\s+in\s+(.+)$/i);
    if (gm) return { verb: "Grepped", detail: gm[1], meta: "in " + gm[2].trim() };
    let pat = a.pattern != null ? String(a.pattern) : "";
    if (!pat) {
      const m = msg.match(/Grepped\s+`([^`]+)`/i);
      pat = m ? m[1] : msg.replace(/^Grepped\s*/i, "").replace(/`?\s*$/, "");
    }
    let meta = "in project";
    if (a.glob_filter) meta = "in " + String(a.glob_filter);
    return { verb: "Grepped", detail: pat, meta: meta };
  }
  if (t === "read_repo_file" || /^Read\s/i.test(msg)) {
    const fp = a.file_path || msg.replace(/^Read\s+/i, "").split(/\s+L\d/)[0].trim();
    let meta = "";
    const start = a.start_line;
    const end = a.end_line;
    if (start && end) meta = "L" + start + "-" + end;
    else if (start) meta = "L" + start + "+";
    else {
      const m = msg.match(/\s(L\d[\d+-]*)\s*$/);
      if (m) meta = m[1];
    }
    return _livecodeFileActivityParts("Read", fp, meta);
  }
  if (t === "list_repo_dir" || msg.startsWith("Explored")) {
    const dir = String(a.directory || "").trim() || msg.replace(/^Explored\s+/i, "") || "project";
    return { verb: "Explored", detail: dir === "project" ? "project" : _livecodeBasename(dir) || dir, meta: "" };
  }
  if (t === "ast_symbols") {
    const fp = a.file_path || msg.replace(/^Explored\s+/i, "").trim();
    return _livecodeFileActivityParts("Explored", fp, "");
  }
  if (t === "write_file" || t === "edit_file" || msg.startsWith("Editing")) {
    const fp = a.file_path || msg.replace(/^Editing\s+/i, "").trim();
    return _livecodeFileActivityParts("Editing", fp, "");
  }
  if (t === "run_command" || msg.startsWith("Running")) {
    const rawCmd = String(a.command || msg.replace(/^Running\s*`?/i, "").replace(/`?\s*$/, ""));
    const cmd = typeof window.livecodeCommandHeaderLabel === "function" ? window.livecodeCommandHeaderLabel(rawCmd) : rawCmd.slice(0, 72);
    return { verb: "Executed", detail: cmd, meta: "" };
  }
  if (/^Thinking$/i.test(msg)) {
    return { verb: "Thinking", detail: "", meta: "" };
  }
  if (t === "attempt_completion") {
    return { verb: "", detail: "", meta: "" };
  }
  if (msg === "Thought briefly" || /^Thought\b/i.test(msg)) {
    const m = msg.match(/for\s+(\d+)s/i);
    const durationS = m ? m[1] : _livecodeComputeThoughtDuration();
    return { verb: "thought", detail: durationS + "s", meta: "", thoughtContent: "" };
  }
  if (t === "error" || /^Failed\b/i.test(msg)) {

    const rawDetail = msg.replace(/^Failed\s+/i, "");
    const full = rawDetail;
    const compact = _livecodeTruncateMiddle(rawDetail, 140);
    return { verb: "Failed", detail: compact, meta: "", isError: true, fullErrorTitle: full };
  }
  if (/^Indexed\s/i.test(msg)) {
    return { verb: "Indexed", detail: msg.replace(/^Indexed\s+/i, ""), meta: "" };
  }
  if (/^Found\s/i.test(msg)) {
    return { verb: "Found", detail: msg.replace(/^Found\s+/i, ""), meta: "" };
  }
  if (/^Exit\s/i.test(msg)) {
    return { verb: "Exit", detail: msg.replace(/^Exit\s+/i, ""), meta: "" };
  }
  if (t === "spawn_subagent" || /^Subagent:/i.test(msg)) {
    const goal = String(a.goal || msg.replace(/^Subagent:\s*/i, "")).trim();
    const summary = _livecodeSubagentSummary(goal);
    return {
      verb: "Subagent",
      detail: summary ? ": " + summary : "",
      meta: "",
      isSubagent: true,
      subagentGoal: goal,
    };
  }
  if (t === "git_log" && a.path) {
    const meta = a.grep ? "grep `" + String(a.grep).slice(0, 40) + "`" : "";
    return _livecodeFileActivityParts("Git log", a.path, meta);
  }
  return { verb: msg.split(/\s/)[0] || "Working", detail: msg.split(/\s/).slice(1).join(" "), meta: "" };
}

function _livecodeMarkdownToSafeHtml(text) {
  var md = String(text || "");
  if (typeof window._linkifyBareUrlsInMarkdownGlobal === "function") {
    md = window._linkifyBareUrlsInMarkdownGlobal(md);
  }
  if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(marked.parse(md));
  }
  return _livecodeEscapeHtml(md).replace(/\n/g, "<br>");
}

function _livecodePrepareThoughtMarkdown(text) {
  var md = String(text || "");
  if (typeof window._linkifyBareUrlsInMarkdownGlobal === "function") {
    md = window._linkifyBareUrlsInMarkdownGlobal(md);
  }
  return md;
}

function _livecodeRenderThoughtMarkdown(el, markdown) {
  if (!el) return;
  el.classList.add("livecode-markdown-content", "mdpdf-preview-body");
  const md = _livecodePrepareThoughtMarkdown(markdown);
  if (!md.trim()) {
    el.innerHTML = "";
    return;
  }
  if (typeof window.renderMarkdownLikeMdpdfPreview === "function") {
    window.renderMarkdownLikeMdpdfPreview(el, md, "livecode-thought-mermaid-");
    return;
  }
  el.innerHTML = _livecodeMarkdownToSafeHtml(md);
}

function _livecodeRenderThoughtBody(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return '<div class="livecode-thought-content livecode-markdown-content mdpdf-preview-body"></div>';
}

function _livecodeUpgradeToStreamingThought() {
  if (!_livecodeRunningActivityEl) return null;
  const outer = _livecodeRunningActivityEl;
  let wrap = outer.querySelector(".livecode-thought-wrap");
  if (!wrap) {
    const secs = _livecodeComputeThoughtDuration();
    const thinkingLabel = secs > 1 ? ("Thinking " + secs + "s") : "Thinking";
    outer.innerHTML =
      '<div class="livecode-activity-wrap livecode-thought-wrap is-streaming">' +
      '<span class="livecode-activity-line is-running"><span class="livecode-activity-text livecode-text-shimmer livecode-thought-header">' +
      _livecodeEscapeHtml(thinkingLabel) +
      "</span></span>" +
      '<div class="livecode-thought-body"><div class="livecode-thought-content livecode-markdown-content mdpdf-preview-body"></div></div></div>';
    wrap = outer.querySelector(".livecode-thought-wrap");
  }
  if (wrap) {
    wrap.classList.add("is-streaming");
  }
  _livecodeStreamingThoughtContentEl = outer.querySelector(".livecode-thought-content");
  if (_livecodeStreamingThoughtContentEl) {
    _livecodeStreamingThoughtContentEl.classList.add("livecode-markdown-content");
  }
  return _livecodeStreamingThoughtContentEl;
}

function _livecodeCancelThoughtStreamFlush() {
  if (_livecodeThoughtStreamFlushTimer) {
    clearTimeout(_livecodeThoughtStreamFlushTimer);
    _livecodeThoughtStreamFlushTimer = null;
  }
}

function _livecodeFlushStreamingThoughtDom() {
  _livecodeThoughtStreamFlushTimer = null;
  const contentEl = _livecodeStreamingThoughtContentEl || _livecodeUpgradeToStreamingThought();
  if (!contentEl) return;
  _livecodeRenderThoughtMarkdown(contentEl, _livecodePendingThoughtContent);
  const output = getLiveCodeChatOutput();
  if (output) output.scrollTop = output.scrollHeight;
}

function _livecodeScheduleThoughtStreamFlush() {
  if (_livecodeThoughtStreamFlushTimer) return;
  _livecodeThoughtStreamFlushTimer = setTimeout(
    _livecodeFlushStreamingThoughtDom,
    _LIVECODE_THOUGHT_STREAM_FLUSH_MS
  );
}

function _livecodeRevealStreamingThoughtBody() {
  if (!_livecodeRunningActivityEl) return;
  const wrap = _livecodeRunningActivityEl.querySelector(".livecode-thought-wrap");
  if (!wrap) return;
  const body = wrap.querySelector(".livecode-thought-body");
  if (!body) return;
  body.hidden = false;
}

function _livecodeAppendThoughtDelta(delta) {
  const text = String(delta || "");
  if (!text) return;
  _livecodePendingThoughtContent += text;
  if (_livecodePendingThoughtContent.length > _LIVECODE_MAX_THOUGHT_CHARS) {
    _livecodePendingThoughtContent = _livecodePendingThoughtContent.slice(-_LIVECODE_MAX_THOUGHT_CHARS);
  }

  if (!_livecodeStreamingThoughtContentEl) _livecodeUpgradeToStreamingThought();
  _livecodeRevealStreamingThoughtBody();
  _livecodeScheduleThoughtStreamFlush();
}

function _livecodeFinalizeThoughtActivity(thoughtContent, output) {
  _livecodeCancelThoughtStreamFlush();
  let thought = String(thoughtContent || _livecodePendingThoughtContent || "").trim();
  if (thought.length > _LIVECODE_MAX_THOUGHT_CHARS) {
    thought = thought.slice(-_LIVECODE_MAX_THOUGHT_CHARS).trim();
  }
  _livecodeStreamingThoughtContentEl = null;
  _livecodeStopThinkingTicker();

  _livecodePendingThoughtContent = thought;
  output = output || getLiveCodeChatOutput();
  _livecodeResolveRunningActivityEl(output);
  _livecodeCleanupStaleThinkingLines(output, _livecodeRunningActivityEl);
  if (_livecodeRunningActivityEl) {
    _livecodeRunningActivityEl.classList.remove("is-running");
    _livecodeRunningActivityEl.innerHTML = _livecodeBuildActivityHtml(_livecodeThoughtParts(), false);
    const contentEl = _livecodeRunningActivityEl.querySelector(".livecode-thought-content");
    if (contentEl && thought) _livecodeRenderThoughtMarkdown(contentEl, thought);
    _livecodeRunningActivityEl = null;
  } else {
    const wrap = _livecodeAppendActivityParts(_livecodeThoughtParts(), false, output);
    if (wrap && thought) {
      const contentEl = wrap.querySelector(".livecode-thought-content");
      if (contentEl) _livecodeRenderThoughtMarkdown(contentEl, thought);
    }
  }
  _livecodePendingThoughtContent = "";
  _livecodePendingDurationS = null;
  _livecodeThinkingStartMs = null;
  if (output) output.scrollTop = output.scrollHeight;
}

function _livecodeFlattenThoughtBlocks(root) {
  if (!root) return;
  root.querySelectorAll(".livecode-thought-wrap").forEach(function(wrap) {
    wrap.classList.remove("is-collapsed", "is-expandable");
    wrap.classList.add("is-static");
    const body = wrap.querySelector(".livecode-thought-body");
    if (body) body.hidden = false;
    wrap.querySelectorAll(".livecode-activity-chevron").forEach(function(el) {
      el.remove();
    });
    const toggle = wrap.querySelector(".livecode-thought-toggle");
    if (toggle && toggle.tagName === "BUTTON") {
      const line = toggle.querySelector(".livecode-activity-line")
        || toggle.querySelector(".livecode-thought-header");
      if (line) toggle.replaceWith(line.cloneNode(true));
      else toggle.replaceWith(...Array.from(toggle.childNodes));
    }
  });
}

function _livecodeRunningVerb(verb) {
  const map = {
    Grepped: "Grepping",
    Read: "Reading",
    Explored: "Exploring",
    Editing: "Editing",
    Executed: "Running",
    Thought: "Thinking",
    thought: "Thinking",
    Thinking: "Thinking",
    Indexed: "Indexing",
    Found: "Finding",
    Failed: "Failing",
    Compacted: "Compacting",
    Subagent: "Subagent",
  };
  return map[verb] || verb;
}

window.refreshLivecodeShimmerStyle = function() {

};

function _livecodeActivityDetailHtml(p) {
  const detail = String(p.detail || "").trim();
  if (!detail) return "";
  const filePath = String(p.detailFilePath || "").trim();
  if (filePath) {
    const safePath = _livecodeEscapeHtml(filePath).replace(/"/g, "&quot;");
    const safeDetail = _livecodeEscapeHtml(detail);
    const meta = p.meta ? String(p.meta).trim() : "";
    const safeMeta = _livecodeEscapeHtml(meta).replace(/"/g, "&quot;");
    return ` <span class="livecode-activity-detail"><span class="livecode-activity-file-link livecode-diff-file-name-link" role="link" tabindex="0" data-file-path="${safePath}" data-line-meta="${safeMeta}" title="${safePath}">${safeDetail}</span></span>`;
  }
  return ` <span class="livecode-activity-detail">${_livecodeEscapeHtml(detail)}</span>`;
}

function _livecodeActivityLabelHtml(p, running) {
  if (running) {
    const parts = [p.verb, p.detail, p.meta].filter(function(s) { return s; });
    const fullText = _livecodeEscapeHtml(parts.join(" "));
    return `<span class="livecode-activity-text livecode-text-shimmer">${fullText}</span>`;
  }
  const verbText = _livecodeEscapeHtml(p.verb || "");
  const verbHtml = `<span class="livecode-activity-verb">${verbText}</span>`;
  const detail = _livecodeActivityDetailHtml(p);
  const meta = p.meta ? `<span class="livecode-activity-meta">${_livecodeEscapeHtml(p.meta)}</span>` : "";
  return `<span class="livecode-activity-text">${verbHtml}${detail}${meta}</span>`;
}

function _livecodeBuildActivityHtml(parts, running) {
  const p = Object.assign({}, parts || { verb: "", detail: "", meta: "" });
  if (running && p.verb) {
    p.verb = _livecodeRunningVerb(p.verb);
  }
  const runClass = running ? " is-running" : "";
  const errClass = p.isError ? " is-error" : "";
  if (!running && (p.verb === "thought" || p.verb === "Thought")) {
    const thoughtText = String(p.thoughtContent || "").trim();
    const durationLabel = _livecodeThoughtDurationLabel(p);
    const headerHtml =
      `<span class="livecode-activity-line${errClass}"><span class="livecode-activity-text livecode-thought-header">${_livecodeEscapeHtml(durationLabel)}</span></span>`;
    const bodyHtml = thoughtText
      ? `<div class="livecode-thought-body">${_livecodeRenderThoughtBody(thoughtText)}</div>`
      : "";
    return `<div class="livecode-activity-wrap livecode-thought-wrap is-static">${headerHtml}${bodyHtml}</div>`;
  }
  const label = _livecodeActivityLabelHtml(p, running);
  const subagentClass = p.isSubagent ? " livecode-subagent-line" : "";
  let titleAttr = "";
  if (p.isSubagent && (p.subagentGoal || p.detail)) {
    titleAttr = ` title="${_livecodeEscapeHtml(p.subagentGoal || p.detail).replace(/"/g, "&quot;")}"`;
  } else if (p.fullErrorTitle) {
    titleAttr = ` title="${_livecodeEscapeHtml(p.fullErrorTitle).replace(/"/g, "&quot;")}"`;
  }
  return `<div class="livecode-activity-wrap"><span class="livecode-activity-line${subagentClass}${runClass}${errClass}"${titleAttr}>${label}</span></div>`;
}

function _livecodeAppendActivityParts(parts, running, output) {
  output = output || getLiveCodeChatOutput();
  const stepsContainer = _livecodeEnsureAgentStepsRow(output);
  if (!output || !stepsContainer || !parts || !parts.verb) return null;
  const wrap = document.createElement("div");
  wrap.className = "livecode-activity-wrap-outer" + (running ? " is-running" : "");
  wrap.innerHTML = _livecodeBuildActivityHtml(parts, running);
  const line = wrap.firstElementChild;
  stepsContainer.appendChild(wrap);
  if (running) _livecodeRunningActivityEl = wrap;
  output.scrollTop = output.scrollHeight;
  return wrap;
}

function _livecodeFinalizeRunningActivity(options, output) {
  const opts = options || {};
  output = output || getLiveCodeChatOutput();
  _livecodeResolveRunningActivityEl(output);
  if (!_livecodeRunningActivityEl) return;
  if (opts.remove) {
    _livecodeStopThinkingTicker();
    _livecodeCancelThoughtStreamFlush();
    _livecodeRunningActivityEl.remove();
    _livecodeRunningActivityEl = null;
    _livecodePendingDurationS = null;
    _livecodePendingThoughtContent = "";
    _livecodeStreamingThoughtContentEl = null;
    _livecodeThinkingStartMs = null;
    return;
  }
  const parts = opts.editFailed
    ? _livecodeEditFailedParts(opts.args || _livecodeLastToolArgs, opts.message || "", opts.errorKind)
    : _livecodeIsThinkingLine()
      ? _livecodeThoughtParts()
      : _livecodeParseActivityParts(_livecodeLastTool, _livecodeLastToolArgs, _livecodeLastToolLabel);
  if (opts.editFailed) {
    _livecodeStopThinkingTicker();
    _livecodeCancelThoughtStreamFlush();
    _livecodeRunningActivityEl.remove();
    _livecodeRunningActivityEl = null;
    _livecodePendingDurationS = null;
    _livecodePendingThoughtContent = "";
    _livecodeStreamingThoughtContentEl = null;
    _livecodeThinkingStartMs = null;
    _livecodeRecordEditFailure(opts.args || _livecodeLastToolArgs, opts.message || "", opts.errorKind, output);
    return;
  }
  if (_livecodeIsThinkingLine()) {
    _livecodeStopThinkingTicker();
  }
  _livecodeCancelThoughtStreamFlush();
  _livecodeRunningActivityEl.classList.remove("is-running");
  _livecodeRunningActivityEl.innerHTML = _livecodeBuildActivityHtml(parts, false);
  _livecodeRunningActivityEl = null;
  _livecodePendingDurationS = null;
  _livecodePendingThoughtContent = "";
  _livecodeStreamingThoughtContentEl = null;
  if (_livecodeIsThinkingLine() || (parts && (parts.verb === "thought" || parts.verb === "Thought"))) {
    _livecodeThinkingStartMs = null;
  }
}

function _livecodeAppendCompletedActivity(tool, args, message) {
  const parts = _livecodeParseActivityParts(tool, args, message);
  _livecodeAppendActivityParts(parts, false);
}

function _livecodeToolCallArgs(tc) {
  try {
    const fn = (tc && tc.function) || {};
    const raw = fn.arguments || "{}";
    return typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
  } catch (_) {
    return {};
  }
}

function _livecodeHumanToolLabel(tool, args) {
  const a = args || {};
  if (tool === "grep_repo") {
    const pat = String(a.pattern || "").slice(0, 80);
    return a.glob_filter ? "Grepped `" + pat + "` in " + a.glob_filter : "Grepped `" + pat + "`";
  }
  if (tool === "find_files") {
    const q = String(a.query || "").trim();
    const ext = String(a.ext || "").trim();
    const prefix = String(a.path_prefix || "").trim();
    const details = [q ? "`" + q.slice(0, 80) + "`" : "project", ext ? ("ext " + ext) : "", prefix ? ("in " + prefix) : ""].filter(Boolean).join(" ");
    return "Find files " + details;
  }
  if (tool === "glob_files") {
    const pat = String(a.pattern || "").trim();
    const dir = String(a.path || "").trim();
    const details = [pat ? "`" + pat.slice(0, 80) + "`" : "project", dir ? ("in " + dir) : ""].filter(Boolean).join(" ");
    return "Glob " + details;
  }
  if (tool === "read_repo_file") {
    const fp = _livecodeBasename(a.file_path || "");
    if (a.start_line && a.end_line) return "Read " + fp + " L" + a.start_line + "-" + a.end_line;
    if (a.start_line) return "Read " + fp + " L" + a.start_line + "+";
    return "Read " + fp;
  }
  if (tool === "list_repo_dir") return "Explored " + (String(a.directory || "").trim() || "project");
  if (tool === "ast_symbols") return "Explored " + _livecodeBasename(a.file_path || "");
  if (tool === "write_file" || tool === "edit_file") return "Editing " + _livecodeBasename(a.file_path || "");
  if (tool === "run_command") return "Running `" + String(a.command || "").slice(0, 72) + "`";
  if (tool === "find_symbol") return "Find symbol `" + String(a.name || "").slice(0, 40) + "`";
  if (tool === "find_references") return "Find refs `" + String(a.name || "").slice(0, 40) + "`";
  if (tool === "list_symbols") return "List symbols in " + String(a.path || "project").slice(0, 40);
  if (tool === "update_memory") return "Updated memory";
  if (tool === "spawn_subagent") return "Subagent: " + String(a.goal || "");
  if (tool === "attempt_completion") return "Thought briefly";
  if (tool === "git_log") {
    if (a.path && a.grep) return "Git log `" + a.path + "` grep `" + String(a.grep).slice(0, 40) + "`";
    if (a.path) return "Git log `" + a.path + "`";
    if (a.grep) return "Git log grep `" + String(a.grep).slice(0, 40) + "`";
    return "Git log";
  }
  return tool || "Working";
}

function _livecodeAppendLoadedToolActivity(msg, output) {
  const calls = (msg && msg.tool_calls) || [];
  if (!calls.length) return;
  calls.forEach(function(tc) {
    const fn = (tc && tc.function) || {};
    const tool = fn.name || "tool";
    const args = _livecodeToolCallArgs(tc);
    const parts = _livecodeParseActivityParts(tool, args, _livecodeHumanToolLabel(tool, args));
    _livecodeAppendActivityParts(parts, false, output);
  });
}

function _livecodeAppendLoadedActivitySummary(text, output) {
  const raw = String(text || "").trim();
  if (!raw) return;
  raw.split(/\n+/).map(function(line) { return line.trim(); }).filter(Boolean).forEach(function(line) {
    _livecodeAppendCompletedActivity("", {}, line);
  });
}

function _livecodeAppendLoadedToolArtifact(msg, output) {
  const tool = msg && msg.tool_name;
  const result = (msg && msg.result) || {};
  const args = (msg && msg.tool_args) || {};
  if ((tool === "write_file" || tool === "edit_file") && result.diff_html) {
    appendLiveCodeDiffBlock({
      file_name: result.file_path || args.file_path || "file",
      diff_html: result.diff_html,
      additions: result.additions || 0,
      deletions: result.deletions || 0,
      absolute_path: result.absolute_path || "",
    }, output);
    return;
  }
  if (tool === "run_command") {
    _livecodeAppendLoadedCommandBlock(result.command || args.command || "", result.output || result.error || "", result.exit_code, output);
    return;
  }
  if (result.error) {
    if (_livecodeIsFileEditTool(tool)) {
      _livecodeRecordEditFailure(args, String(result.error), result.error_kind, output);
      return;
    }
    const full = String(result.error);
    _livecodeAppendActivityParts({
      verb: "Failed",
      detail: _livecodeTruncateMiddle(full, 140),
      meta: "",
      isError: true,
      fullErrorTitle: full,
    }, false, output);
  }
}

function _livecodeFindCommandOutputRow(output, command) {
  output = output || getLiveCodeChatOutput();
  const cmd = String(command || "").trim();
  if (!output || !cmd) return null;
  const shortLabel = typeof window.livecodeCommandHeaderLabel === "function"
    ? window.livecodeCommandHeaderLabel(cmd)
    : cmd;
  const rows = output.querySelectorAll(".livecode-command-output");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.dataset.commandFull === cmd) return row;
    const inputText = _livecodeCommandRowInputText(row);
    if (inputText === cmd || inputText === shortLabel) return row;
  }
  return null;
}

function _livecodeCommandRowOutputEl(row) {
  if (!row) return null;
  return row.querySelector(".livecode-command-output-block code");
}

function _livecodeRemoveCommandOutputBlock(row) {
  if (!row) return;
  const outPre = row.querySelector(".livecode-command-output-block");
  if (outPre) outPre.remove();
}

function _livecodeEnsureCommandOutputBlock(row) {
  if (!row) return null;
  let outPre = row.querySelector(".livecode-command-output-block");
  if (outPre) return outPre.querySelector("code");
  const card = row.querySelector(".livecode-code-card");
  if (!card) return null;
  outPre = document.createElement("pre");
  outPre.className = "livecode-code-block livecode-command-output-block";
  outPre.style.display = "none";
  const outCode = document.createElement("code");
  outCode.className = "monaco-enhanced";
  outPre.appendChild(outCode);
  card.appendChild(outPre);
  return outCode;
}

function _livecodeSetCommandOutputBlock(row, outputText) {
  const text = _livecodeSanitizeCommandOutput(outputText);
  if (!text) {
    _livecodeRemoveCommandOutputBlock(row);
    return;
  }
  const codeEl = _livecodeEnsureCommandOutputBlock(row);
  const preEl = codeEl ? codeEl.closest(".livecode-command-output-block") : null;
  if (!codeEl || !preEl) return;
  codeEl.textContent = text;
  preEl.style.display = "";
}

function _livecodeCommandRowInputText(row) {
  if (!row) return "";
  const cmdEl = row.querySelector(".livecode-command-input-block code");
  return cmdEl ? String(cmdEl.textContent || "").trim() : "";
}

function _livecodeCommandRowOutputText(row) {
  const codeEl = _livecodeCommandRowOutputEl(row);
  return codeEl ? String(codeEl.textContent || "") : "";
}

function _livecodeUpdateCommandOutputRow(row, outputText, exitCode) {
  _livecodeSetCommandOutputBlock(row, outputText);
}

function _livecodeRemoveEmptyDuplicateCommandRows(output, command, keepRow) {
  output = output || getLiveCodeChatOutput();
  const cmd = String(command || "").trim();
  if (!output || !cmd || !keepRow) return;
  const shortLabel = typeof window.livecodeCommandHeaderLabel === "function"
    ? window.livecodeCommandHeaderLabel(cmd)
    : cmd;
  const rows = output.querySelectorAll(".livecode-command-output");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === keepRow) continue;
    if (row.dataset.commandFull === cmd) {
      if (!_livecodeCommandRowOutputText(row).trim()) row.remove();
      continue;
    }
    const inputText = _livecodeCommandRowInputText(row);
    if (inputText !== cmd && inputText !== shortLabel) continue;
    if (!_livecodeCommandRowOutputText(row).trim()) row.remove();
  }
}

function _livecodeHasCommandOutputRow(output, command) {
  return !!_livecodeFindCommandOutputRow(output, command);
}

function _livecodeAppendLoadedCommandBlock(command, outputText, exitCode, container) {
  container = container || getLiveCodeChatOutput();
  if (!container) return;
  let row = null;
  if (typeof window.livecodeBuildRestoredCommandRow === "function") {
    row = window.livecodeBuildRestoredCommandRow(command, outputText, exitCode, { classPrefix: "livecode" });
  }
  if (!row) {
    row = window.livecodeBuildRestoredCommandRow(command, outputText, exitCode);
  }
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  _livecodeSyncActiveTabMessagesHtml();
}

function _livecodeRenderAssistantMarkdown(el, text) {
  if (!el) return;
  const md = text || "";
  el.setAttribute("data-raw-md", md);
  if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
    el.innerHTML = _livecodeMarkdownToSafeHtml(md);
    if (typeof window._decorateChatLinksGlobal === "function") {
      window._decorateChatLinksGlobal(el);
    }
    if (typeof window._decorateCodeBlocksGlobal === "function") {
      window._decorateCodeBlocksGlobal(el, { livecode: true });
    }
  } else {
    el.textContent = md;
  }
}

function _livecodeActivityFeedActive() {
  return !!livecodeAgentRunning;
}

function _livecodeShowImmediateThinking(output) {
  output = output || getLiveCodeChatOutput();
  if (_livecodeRunningActivityEl && _livecodeIsThinkingLine()) {
    _livecodeStartThinkingTicker();
    return;
  }
  _livecodeThinkingStartMs = Date.now();
  _livecodeLastTool = "attempt_completion";
  _livecodeLastToolArgs = {};
  _livecodeLastToolLabel = "Thinking";
  _livecodeAppendActivityParts({ verb: "Thinking", detail: "", meta: "" }, true, output);
  _livecodeStartThinkingTicker();
}

function _livecodeEnsureStatusRow(output) {
  output = output || getLiveCodeChatOutput();
  if (!output) return;
  if (!_livecodeStatusRow) {
    _livecodeStatusRow = document.createElement("div");
    _livecodeStatusRow.className = "chat-row livecode-status-row";
    _livecodeStatusRow.id = "livecode-agent-status-row";
    _livecodeStatusMsg = document.createElement("div");
    _livecodeStatusMsg.className = "chat-msg assistant livecode-status-msg livecode-typing-indicator";
    _livecodeStatusRow.appendChild(_livecodeStatusMsg);
  }
  if (!_livecodeStatusRow.parentNode) _livecodeAppendChatRow(output, _livecodeStatusRow);
  else if (_livecodeStatusRow !== output.lastElementChild) {
    const anchor = _livecodeGetAssistantAnchor(output);
    if (anchor && anchor.parentNode === output) {
      output.insertBefore(_livecodeStatusRow, anchor);
    } else {
      output.appendChild(_livecodeStatusRow);
    }
  }
}

function _livecodeShowTyping(hint, output) {
  if (_livecodeActivityFeedActive()) return;
  output = output || getLiveCodeChatOutput();
  _livecodeEnsureStatusRow(output);
  if (!_livecodeStatusMsg) return;
  _livecodeStatusMsg.classList.remove("livecode-running-status");
  _livecodeStatusMsg.classList.add("livecode-typing-indicator");
  if (hint) {
    _livecodeStatusMsg.innerHTML = `<span class="livecode-typing-hint">${_livecodeEscapeHtml(hint)}</span>${_livecodeTypingMarkup()}`;
  } else {
    _livecodeStatusMsg.innerHTML = _livecodeTypingMarkup();
  }
  if (output) output.scrollTop = output.scrollHeight;
}

function _livecodeShowShimmer(message, output) {
  if (_livecodeActivityFeedActive()) return;
  output = output || getLiveCodeChatOutput();
  _livecodeEnsureStatusRow(output);
  if (!_livecodeStatusMsg) return;
  _livecodeStatusMsg.classList.remove("livecode-typing-indicator");
  _livecodeStatusMsg.classList.add("livecode-running-status");
  _livecodeStatusMsg.innerHTML = `<span class="livecode-text-shimmer">${_livecodeEscapeHtml(message)}</span>`;
  if (output) output.scrollTop = output.scrollHeight;
}

let _livecodePendingPermissionRequestId = "";

function _livecodeSetPermissionToolbarVisible(visible) {
  const wrap = document.getElementById("livecode-permission-toolbar-actions");
  if (!wrap) return;
  wrap.style.display = visible ? "flex" : "none";
}

function _livecodeRemovePermissionRows(requestId, output) {
  output = output || getLiveCodeChatOutput();
  if (!output) return;
  const rows = output.querySelectorAll(".livecode-permission-row");
  rows.forEach(function(row) {
    if (!requestId || (row.dataset && row.dataset.requestId === requestId)) {
      row.remove();
    }
  });
}

function _livecodeResolvePermissionRequest(requestId, approved, output) {
  if (!requestId) return;
  output = output || getLiveCodeChatOutput();
  _livecodeRemovePermissionRows(requestId, output);
  if (_livecodePendingPermissionRequestId === requestId) {
    _livecodePendingPermissionRequestId = "";
    _livecodeSetPermissionToolbarVisible(false);
  }
  const targetTab = livecodeChatTabs.find(function(t) { return t.id === livecodeActiveChatTabId; });
  if (targetTab && output) {
    _livecodeScheduleProgressSnapshot(targetTab, output, true, true);
  }
  fetch("/livecode/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, approved: approved }),
  }).catch(function() {});
}

function _livecodeShowPermissionRequest(data, output) {
  output = output || getLiveCodeChatOutput();
  if (!output) return;
  const requestId = data.request_id || "";

  if (requestId) {
    _livecodePendingPermissionRequestId = requestId;
    _livecodeSetPermissionToolbarVisible(true);
    const existing = Array.from(output.querySelectorAll(".livecode-permission-row"))
      .find(function(row) { return row.dataset && row.dataset.requestId === requestId; });
    if (existing) {
      output.scrollTop = output.scrollHeight;
      return;
    }
  }
  const tool = data.tool || "";
  const args = data.args || {};
  const command = args.command || "";
  const filePath = args.file_path || args.path || "";

  function previewValue(value) {
    if (value == null || value === "") return "";
    let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    text = String(text || "").trim();
    return text.length > 180 ? text.slice(0, 177) + "…" : text;
  }

  const detailRows = [];
  if (filePath) {
    detailRows.push(`<div class="livecode-permission-extra"><span class="livecode-permission-extra-label">File</span><code>${_livecodeEscapeHtml(filePath)}</code></div>`);
  }
  if (args.directory) {
    detailRows.push(`<div class="livecode-permission-extra"><span class="livecode-permission-extra-label">Dir</span><code>${_livecodeEscapeHtml(args.directory)}</code></div>`);
  }
  const preview = command || previewValue(args.content || args.new_string || args.old_string);
  const headerLabel = command && typeof window.livecodeCommandHeaderLabel === "function"
    ? window.livecodeCommandHeaderLabel(command)
    : (tool || "action");
  let codeInner = "";
  if (command) {
    codeInner = '<span class="livecode-cmd-prompt">$ ' + _livecodeEscapeHtml(command) + "</span>";
  } else if (preview) {
    codeInner = _livecodeEscapeHtml(preview);
  } else {
    codeInner = _livecodeEscapeHtml(tool || "unknown");
  }

  const row = document.createElement("div");
  row.className = "chat-row livecode-permission-row livecode-command-output";
  row.dataset.requestId = requestId;

  const msg = document.createElement("div");
  msg.className = "chat-msg assistant livecode-permission-msg livecode-plain-msg";
  msg.innerHTML = `
    <div class="livecode-permission-stack theme-transition">
      <div class="livecode-permission-kicker">Permission required</div>
      <div class="code-card livecode-code-card livecode-permission-code-card theme-transition">
        <div class="code-card-header">
          <span class="lang">${_livecodeEscapeHtml(headerLabel)}</span>
        </div>
        <pre class="livecode-code-block livecode-permission-command"><code class="monaco-enhanced">${codeInner}</code></pre>
      </div>
      ${detailRows.join("")}
    </div>
  `;
  row.appendChild(msg);
  _livecodeAppendChatRow(output, row);
  if (typeof decorateCodeBlocks === "function") {
    const codeCard = msg.querySelector(".livecode-permission-code-card");
    if (codeCard) decorateCodeBlocks(codeCard);
  }
  output.scrollTop = output.scrollHeight;

  function resolve(approved) {
    if (row.dataset.resolved) return;
    row.dataset.resolved = approved ? "approved" : "denied";
    _livecodeResolvePermissionRequest(requestId, approved, output);
  }

  const approveBtn = msg.querySelector(".livecode-permission-approve");
  const denyBtn = msg.querySelector(".livecode-permission-deny");
  if (approveBtn) approveBtn.addEventListener("click", function() { resolve(true); });
  if (denyBtn) denyBtn.addEventListener("click", function() { resolve(false); });
}

function _livecodeHideStatusRow() {
  if (_livecodeStatusRow && _livecodeStatusRow.parentNode) _livecodeStatusRow.remove();
}

function _livecodeClearPendingToolSteps() {
  _livecodeFinalizeRunningActivity();
  _livecodeHideStatusRow();
}

let _livecodeProgressSnapshotTimer = null;
const _livecodeProgressSnapshotTimersByTab = {};

function _livecodeFlushProgressSnapshot(targetTab, output, isActiveTab) {
  if (!targetTab || !output) return;
  targetTab.messagesHtml = output.innerHTML;
  if (!isActiveTab) {
    targetTab.hasUnread = true;
    _livecodeRenderChatTabs();
  } else if (targetTab.messagesHtml && targetTab.sessionId) {
    _livecodeSyncActiveTabMessagesHtml();
  }
}

function _livecodeScheduleProgressSnapshot(targetTab, output, isActiveTab, immediate) {
  const tabId = targetTab && targetTab.id;
  if (immediate) {
    if (tabId && _livecodeProgressSnapshotTimersByTab[tabId]) {
      clearTimeout(_livecodeProgressSnapshotTimersByTab[tabId]);
      delete _livecodeProgressSnapshotTimersByTab[tabId];
    }
    _livecodeFlushProgressSnapshot(targetTab, output, isActiveTab);
    return;
  }
  if (!tabId) return;
  if (_livecodeProgressSnapshotTimersByTab[tabId]) {
    clearTimeout(_livecodeProgressSnapshotTimersByTab[tabId]);
  }
  _livecodeProgressSnapshotTimersByTab[tabId] = setTimeout(function() {
    delete _livecodeProgressSnapshotTimersByTab[tabId];
    _livecodeFlushProgressSnapshot(targetTab, output, isActiveTab);
  }, 1500);
}

function handleLiveCodeProgress(data) {
  if (!data) return;
  const sessionId = data.session_id || "";
  const turnId = data.turn_id || "";
  const seq = Number(data.seq || 0);
  const targetTab = livecodeChatTabs.find(function(t) { return t.sessionId === data.session_id; });
  if (!targetTab || !targetTab.agentRunning) return;
  if (sessionId && turnId) {
    const activeTurnId = _livecodeActiveTurnIdBySession[sessionId];
    if (activeTurnId && activeTurnId !== turnId) return;
    _livecodeActiveTurnIdBySession[sessionId] = turnId;
  }
  if (sessionId && seq) {
    const seqKey = turnId ? (sessionId + ":" + turnId) : sessionId;
    const lastSeq = _livecodeLastProgressSeqBySession[seqKey] || 0;
    if (seq <= lastSeq) return;
    _livecodeLastProgressSeqBySession[seqKey] = seq;
  }

  const isActiveTab = targetTab.id === livecodeActiveChatTabId;
  const output = _livecodeGetOutputForTab(targetTab);
  if (!output) return;

  _livecodeWithTabContext(targetTab, function() {
    if (isActiveTab) {
      if (data.session_id !== livecodeAgentSessionId) return;
      if (!_livecodeChatOutputBelongsToTab(getLiveCodeChatOutput(), targetTab)) return;
    }

    if (data.status === "complete") {

      targetTab._turnStreamComplete = true;
      _livecodeScheduleProgressSnapshot(targetTab, output, isActiveTab, true);
      return;
    }
    if (data.status !== "progress") return;

    const progressType = data.type || "shimmer";

    if (
      (targetTab._answerStreaming || targetTab._turnStreamComplete) &&
      progressType !== "permission_request"
    ) {
      return;
    }

    const message = data.message || "";
    const tool = data.tool || "";
    const args = data.args || {};

    if (progressType === "permanent") {
      return;
    } else if (progressType === "diff_block") {
      _livecodeFinalizeRunningActivity({ remove: true }, output);
      appendLiveCodeDiffBlock({
        file_name: data.file_name,
        diff_html: message,
        additions: data.additions || 0,
        deletions: data.deletions || 0,
        absolute_path: data.absolute_path || "",
      }, output);
    } else if (progressType === "plan_created") {

      const planFile = data.plan_file || "";
      const planTitle = data.plan_title || message || "Plan";
      targetTab.planFile = planFile;
      if (planFile) window.openLiveCodePlanTab(planFile, planTitle);
    } else if (progressType === "compaction") {
      _livecodeFinalizeRunningActivity(undefined, output);
      _livecodeHideStatusRow();
      _livecodeAppendActivityParts({
        verb: "Compacted",
        detail: "conversation history",
        meta: data.forced ? "context limit" : "",
      }, false, output);
    } else if (progressType === "model_resolved") {
      return;
    } else if (progressType === "agent_thinking") {
      _livecodeHideStatusRow();
      _livecodeCancelThoughtStreamFlush();
      _livecodePendingThoughtContent = "";
      _livecodeStreamingThoughtContentEl = null;
      if (_livecodeRunningActivityEl && _livecodeIsThinkingLine()) {
        _livecodeThinkingStartMs = Date.now();
        _livecodeStartThinkingTicker();
        return;
      }
      _livecodeThinkingStartMs = Date.now();
      _livecodeLastTool = "attempt_completion";
      _livecodeLastToolArgs = {};
      _livecodeFinalizeRunningActivity(undefined, output);
      if (message && !/^Thinking$/i.test(message.trim())) {
        _livecodeLastToolLabel = message;
        _livecodeAppendActivityParts(_livecodeParseActivityParts("attempt_completion", {}, message), true, output);
      } else {
        _livecodeLastToolLabel = "Thinking";
        _livecodeAppendActivityParts({ verb: "Thinking", detail: "", meta: "" }, true, output);
      }
      _livecodeStartThinkingTicker();
    } else if (progressType === "agent_thinking_delta") {
      if (/^Retrying\b/i.test(String(_livecodeLastToolLabel || "").trim())) {
        _livecodeLastToolLabel = "Thinking";
        _livecodeThinkingStartMs = Date.now();
        _livecodeStartThinkingTicker();
      }
      if (!_livecodeIsThinkingLine()) {
        _livecodeLastTool = "attempt_completion";
        _livecodeLastToolLabel = "Thinking";
        if (!_livecodeThinkingStartMs) _livecodeThinkingStartMs = Date.now();
        _livecodeStartThinkingTicker();
      }
      _livecodeAppendThoughtDelta(data.delta || "");
    } else if (progressType === "agent_thinking_done") {
      _livecodePendingDurationS = data.duration_s || null;
      _livecodeFinalizeThoughtActivity(data.thought_content || "", output);
    } else if (progressType === "tool_call") {
      _livecodeFinalizeRunningActivity(undefined, output);
      _livecodeLastTool = tool;
      _livecodeLastToolArgs = args;
      _livecodeLastToolLabel = message;
      _livecodeHideStatusRow();
      if (tool === "edit_file" && args && args.file_path) {
        const stepsContainer = _livecodeEnsureAgentStepsRow(output);
        _livecodeClearTransientEditFailure(args.file_path, stepsContainer);
      }
      if (tool !== "attempt_completion") {
        const parts = _livecodeParseActivityParts(tool, args, message);
        _livecodeAppendActivityParts(parts, true, output);
      }
    } else if (progressType === "tool_result") {
      const errorMessage = data.error_full || message;
      if (tool === "run_command" && data.result) {
        const cmd = String((args && args.command) || data.result.command || "");
        const cmdOut = String(data.result.output || data.result.error || "");
        const exitCode = data.result.exit_code;
        if (cmd) {
          const existing = _livecodeFindCommandOutputRow(output, cmd);
          if (existing) {
            if (!_livecodeCommandRowOutputText(existing).trim() && cmdOut) {
              _livecodeUpdateCommandOutputRow(existing, cmdOut, exitCode);
            }
            _livecodeRemoveEmptyDuplicateCommandRows(output, cmd, existing);
          } else {
            _livecodeAppendLoadedCommandBlock(cmd, cmdOut, exitCode, output);
          }
        }
      }
      if (data.error && errorMessage && _livecodeRunningActivityEl && _livecodeIsFileEditTool(tool)) {
        _livecodeRecordEditFailure(
          data.args || _livecodeLastToolArgs,
          errorMessage,
          data.error_kind,
          output
        );
      } else if (tool === "attempt_completion") {
        _livecodeFinalizeRunningActivity({ remove: true }, output);
      } else {
        if (!data.error && message && _livecodeRunningActivityEl) {
          _livecodeLastToolLabel = message;
        }
        _livecodeFinalizeRunningActivity(undefined, output);
        if (data.error && errorMessage) {
          if (_livecodeIsFileEditTool(tool)) {
            _livecodeRecordEditFailure(
              data.args || _livecodeLastToolArgs,
              errorMessage,
              data.error_kind,
              output
            );
          } else {
            const full = String(errorMessage);
            const parts = {
              verb: "Failed",
              detail: _livecodeTruncateMiddle(full, 140),
              meta: "",
              isError: true,
              fullErrorTitle: full,
            };
            _livecodeAppendActivityParts(parts, false, output);
          }
        }
      }
      _livecodeHideStatusRow();
      if (!targetTab._turnStreamComplete && tool !== "attempt_completion") {
        _livecodeShowImmediateThinking(output);
      }
    } else if (progressType === "permission_request") {
      _livecodeFinalizeRunningActivity(undefined, output);
      _livecodeHideStatusRow();
      _livecodeShowPermissionRequest(data, output);
    } else if (progressType === "agent_status") {
      const statusMsg = String(message || "").trim();
      if (/retrying model/i.test(statusMsg)) {
        _livecodeThinkingStartMs = Date.now();
        _livecodePendingDurationS = null;
        _livecodeLastToolLabel = "Retrying model…";
        _livecodeStopThinkingTicker();
        _livecodeResolveRunningActivityEl();
        if (_livecodeRunningActivityEl) {
          const textEl = _livecodeRunningActivityEl.querySelector(".livecode-activity-text");
          if (textEl) textEl.textContent = "Retrying model…";
        }
      }
      return;
    } else if (message && !_livecodeIsGenericStatusMessage(message)) {
      _livecodeShowShimmer(message, output);
    } else {
      _livecodeShowTyping(undefined, output);
    }
  });

  _livecodeScheduleProgressSnapshot(targetTab, output, isActiveTab, false);
}

function initLiveCodeAgentSocket() {
  if (window._livecodeAgentSocket) return;
  _livecodeBindDiffFileNameClicksOnce();
  window._livecodeAgentSocket = (typeof socket !== "undefined" && socket) ? socket : io.connect(location.protocol + "//" + location.host);
  window._livecodeAgentSocket.on("livecode_progress", handleLiveCodeProgress);
  if (!window._livecodeCommandBound) {
    window._livecodeCommandBound = true;
    _livecodeEnsureCommandStreamHandler();
    window._livecodeAgentSocket.on("agent_command_stream", function(data) {
      _livecodeEnsureCommandStreamHandler();
      if (_livecodeCommandStreamHandler) _livecodeCommandStreamHandler(data);
    });
  }
}

function _livecodeParseDiffLineHint(diffHtml) {
  const html = String(diffHtml || "");
  const startM = html.match(/data-start-line="(\d+)"/);
  if (!startM) return "";
  const endM = html.match(/data-end-line="(\d+)"/);
  const start = startM[1];
  if (endM && endM[1] !== start) return "L" + start + "-" + endM[1];
  return "L" + start;
}

function _livecodeSplitDiffHunks(diffHtml, fallbackStats) {
  const html = String(diffHtml || "").trim();
  if (!html) return [];

  const template = document.createElement("template");
  template.innerHTML = html;
  const wrappers = template.content.querySelectorAll(".diff-block-wrapper");
  if (!wrappers.length) {
    return [{
      html: html,
      startLine: 0,
      endLine: 0,
      additions: (fallbackStats && fallbackStats.additions) || 0,
      deletions: (fallbackStats && fallbackStats.deletions) || 0,
    }];
  }

  const hunks = [];
  wrappers.forEach(function(wrapper) {
    const startLine = parseInt(wrapper.getAttribute("data-start-line") || "0", 10) || 0;
    const endLine = parseInt(wrapper.getAttribute("data-end-line") || "0", 10) || 0;
    let additions = parseInt(wrapper.getAttribute("data-additions") || "", 10);
    let deletions = parseInt(wrapper.getAttribute("data-deletions") || "", 10);
    if (Number.isNaN(additions)) {
      additions = wrapper.querySelectorAll(".diff-line-added").length;
    }
    if (Number.isNaN(deletions)) {
      deletions = wrapper.querySelectorAll(".diff-line-deleted").length;
    }
    if (wrappers.length === 1 && fallbackStats) {
      if (!additions && fallbackStats.additions) additions = fallbackStats.additions;
      if (!deletions && fallbackStats.deletions) deletions = fallbackStats.deletions;
    }
    hunks.push({
      html: wrapper.outerHTML,
      startLine: startLine,
      endLine: endLine,
      additions: additions,
      deletions: deletions,
    });
  });
  return hunks;
}

function _livecodeBuildDiffBlockHtml({ fileName, absolutePath, fileIcon, addedText, deletedText, diffContent, diffBlockId, lineHint }) {
  const safeFullPath = _livecodeEscapeHtml(fileName);
  const baseName = String(fileName || "").split("/").pop() || fileName;
  const safeBaseName = _livecodeEscapeHtml(baseName);

  const openPath = absolutePath || fileName;
  const safeFilePathAttr = _livecodeEscapeHtml(openPath).replace(/'/g, "&#39;");
  const lineMetaAttr = lineHint
    ? ` data-line-meta="${_livecodeEscapeHtml(lineHint).replace(/'/g, "&#39;")}"`
    : "";
  const lineHintHtml = lineHint
    ? `<span class="livecode-diff-line-hint">${_livecodeEscapeHtml(lineHint)}</span>`
    : "";
  const blockClass = "livecode-diff-block livecode-diff-small is-expanded";
  const diffBodyHtml = `<div class="livecode-diff-scroll-inner">${diffContent}</div>`;

  return `<div class="${blockClass}"><div class="livecode-diff-header-row"><div class="livecode-diff-header-static"><div class="livecode-diff-header-content"><img src="${fileIcon}" class="livecode-diff-file-icon" alt="" onerror="this.onerror=null;this.src='${window.DEFAULT_FILE_ICON}'"><span class="livecode-diff-file-name-link" title="${safeFullPath}" data-file-path="${safeFilePathAttr}"${lineMetaAttr}>${safeBaseName}</span>${lineHintHtml}${addedText || ""}${deletedText || ""}</div></div></div><div id="${diffBlockId}-content" class="livecode-diff-content">${diffBodyHtml}</div></div>`;
}

function _livecodeBindDiffFileNameClicksOnce() {
  if (window._livecodeDiffFileNameClicksBound) return;
  window._livecodeDiffFileNameClicksBound = true;
  document.addEventListener("click", function(e) {
    const label = e.target.closest
      ? e.target.closest(".livecode-diff-file-name-link, .livecode-activity-file-link")
      : null;
    if (!label || !label.closest("#livecode-chat-messages")) return;
    const filePath = label.getAttribute("data-file-path");
    if (!filePath) return;
    e.preventDefault();
    e.stopPropagation();
    showIDEPanel("editor");
    const meta = String(label.getAttribute("data-line-meta") || "").trim();
    const m = meta.match(/^L(\d+)/i);
    const lineNumber = m ? _livecodeNormalizeLineNumber(m[1]) : null;
    openFileInEditorFromPath(filePath, lineNumber ? { lineNumber: lineNumber } : {});
  });
}

function appendLiveCodeDiffBlock(data, container) {
  const out = container || getLiveCodeChatOutput();
  if (!out) return;
  _livecodeBindDiffFileNameClicksOnce();
  const fileName = data.file_name || "file";
  const fileIcon = typeof window.getFileIcon === "function"
    ? window.getFileIcon(fileName)
    : "/asset/file-icons/default_file.svg";
  const absolutePath = data.absolute_path || "";
  const diffHtml = data.diff_html || "";
  const hunks = _livecodeSplitDiffHunks(diffHtml, {
    additions: data.additions || 0,
    deletions: data.deletions || 0,
  });
  if (!hunks.length) {
    if (absolutePath) {
      refreshLiveCodeFileFromDisk(absolutePath);
      _livecodeRefreshFileTreeForPath(absolutePath);
    }
    return;
  }

  hunks.forEach(function(hunk, index) {
    const added = hunk.additions > 0
      ? `<span class="livecode-diff-added">+${hunk.additions}</span>`
      : "";
    const deleted = hunk.deletions > 0
      ? `<span class="livecode-diff-deleted">-${hunk.deletions}</span>`
      : "";
    const diffRow = document.createElement("div");
    diffRow.className = "chat-row livecode-stream-msg livecode-diff-row";
    if (index > 0) diffRow.classList.add("livecode-diff-row-follow");
    const diffBlockId = "livecode-diff-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9) + "-" + index;
    const lineHint = _livecodeParseDiffLineHint(hunk.html);
    diffRow.innerHTML = `<div class="chat-msg assistant livecode-plain-msg">${_livecodeBuildDiffBlockHtml({
      fileName: fileName,
      absolutePath: absolutePath,
      fileIcon: fileIcon,
      addedText: added,
      deletedText: deleted,
      diffContent: hunk.html,
      diffBlockId: diffBlockId,
      lineHint: lineHint,
    })}</div>`;
    _livecodeAppendChatRow(out, diffRow);
  });

  out.scrollTop = out.scrollHeight;
  _livecodeSyncActiveTabMessagesHtml();
  if (absolutePath) {
    refreshLiveCodeFileFromDisk(absolutePath);
    _livecodeRefreshFileTreeForPath(absolutePath);
  }
}

function _livecodeNormalizePath(filePath) {
  if (!filePath) return "";
  let p = String(filePath).trim().replace(/\\/g, "/");
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

function _livecodeResolveOpenFileKey(absPath) {
  if (!absPath) return null;
  const normalized = _livecodeNormalizePath(absPath);
  if (ideOpenFiles[normalized]) return normalized;
  if (ideOpenFiles[absPath]) return absPath;
  const keys = Object.keys(ideOpenFiles);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (_livecodeNormalizePath(key) === normalized) return key;
  }
  const lower = normalized.toLowerCase();
  for (let i = 0; i < keys.length; i++) {
    if (_livecodeNormalizePath(keys[i]).toLowerCase() === lower) return keys[i];
  }
  return null;
}

function _livecodeApplyFileContentToOpenTab(filePath, content) {
  if (!filePath || !ideOpenFiles[filePath]) return false;
  const fileInfo = ideOpenFiles[filePath];
  const nextContent = content != null ? content : "";
  fileInfo.content = nextContent;
  fileInfo.originalContent = nextContent;
  fileInfo.modified = false;
  if (fileInfo.model) {
    fileInfo.model.setValue(nextContent);
  }
  const codeEditor = document.getElementById("ide-code-editor");
  if (ideActiveFile === filePath && codeEditor && !fileInfo.model) {
    codeEditor.value = nextContent;
  }
  if (ideActiveFile === filePath && window.ideEditor && fileInfo.model) {
    try {
      window.ideEditor.setModel(fileInfo.model);
    } catch (e) {

    }
  }
  updateOpenFilesList();
  return true;
}

function refreshLiveCodeFileFromDisk(absPath) {
  if (!absPath) return;
  const openKey = _livecodeResolveOpenFileKey(absPath);
  if (!openKey) return;
  _livecodeIdeSocketRequest(
    "ide_read_file", { path: absPath },
    "ide_file_content",
    function(data) { return data && data.path === absPath; }
  ).then(function(result) {
    const data = result.data;
    if (!data.error && data.content !== undefined) {
      const resolvedPath = _livecodeResolveOpenFileKey(data.path || absPath) || openKey;
      _livecodeApplyFileContentToOpenTab(resolvedPath, data.content);
    }
  });
}

function _livecodeResetTurnState() {
  _livecodeStopThinkingTicker();
  _livecodeLastToolLabel = "";
  _livecodeLastTool = "";
  _livecodeLastToolArgs = {};
  _livecodeRunningActivityEl = null;
  _livecodeThinkingStartMs = null;
  _livecodePendingDurationS = null;
  _livecodeCancelThoughtStreamFlush();
  _livecodePendingThoughtContent = "";
  _livecodeStreamingThoughtContentEl = null;
  _livecodeStatusRow = null;
  _livecodeStatusMsg = null;
  _livecodeCurrentUserRow = null;
  _livecodeAssistantStreamEl = null;
  if (_livecodeCommandStreamHandler && typeof _livecodeCommandStreamHandler.reset === "function") {
    _livecodeCommandStreamHandler.reset();
  }
}

function _livecodeInitChatInput(inputEl) {
  if (typeof window.getLivecodeComposerState === "function") {
    const state = window.getLivecodeComposerState();
    const hasAttachments = (state.attachments || []).length > 0;
    const hasText = !!(state.text || "").trim() || (state.segments || []).some(function(s) {
      return s && s.type === "file";
    });
    if (!hasText && !hasAttachments) return;
    if (typeof window.areLivecodeAttachmentsReady === "function" && hasAttachments && !window.areLivecodeAttachmentsReady()) return;
    window.sendLiveCodeAgentMessage(undefined);
    return;
  }
  if (!inputEl) return;
  const msg = (inputEl.value || "").trim();
  const hasAttachments = (window.livecodePendingAttachments || []).length > 0;
  if (!msg && !hasAttachments) return;
  if (typeof window.areLivecodeAttachmentsReady === "function" && hasAttachments && !window.areLivecodeAttachmentsReady()) return;
  inputEl.value = "";
  inputEl.style.height = "auto";
  if (inputEl.scrollHeight) {
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
  }
  window.sendLiveCodeAgentMessage(msg || undefined);
}
window._livecodeInitChatInput = _livecodeInitChatInput;

window.stopLiveCodeAgent = function() {
  const tab = _livecodeGetActiveChatTab();
  if (tab) _livecodeAbortTabTurn(tab);
  _setLiveCodeChatBusy(false);
  livecodeAgentRunning = false;
  renderLiveCodeRecentSessions();
};

window.sendLiveCodeAgentMessage = async function(presetMessage, options) {
  const tab = _livecodeGetActiveChatTab();
  if (!tab || tab.agentRunning) return;
  const turnOptions = options || {};
  const turnMode = turnOptions.mode || window.livecodeChatMode || "agent";

  const turnPlanFile = turnOptions.planFile
    || (turnMode === "plan" ? (tab.planFile || "") : "");
  const composerState = typeof window.getLivecodeComposerState === "function"
    ? window.getLivecodeComposerState()
    : { text: "", segments: [], attachments: [] };
  const apiAttachments = typeof window.getLivecodeApiAttachments === "function"
    ? window.getLivecodeApiAttachments()
    : (composerState.attachments || []).slice();
  const hasAttachments = apiAttachments.length > 0;
  if (typeof window.areLivecodeAttachmentsReady === "function" && hasAttachments && !window.areLivecodeAttachmentsReady()) return;
  let displayQuestion = String(presetMessage != null ? presetMessage : (composerState.text || "")).trim();
  let question = displayQuestion;
  if (!question && hasAttachments && typeof window.buildChatAttachmentPrompt === "function") {
    question = window.buildChatAttachmentPrompt(apiAttachments);
    displayQuestion = displayQuestion || question;
  }
  const hasInlineFiles = (composerState.segments || []).some(function(s) {
    return s && s.type === "file";
  });
  if (!question && !hasAttachments && !hasInlineFiles) return;
  const displayPayload = typeof window.serializeLivecodeDisplayPayload === "function"
    ? window.serializeLivecodeDisplayPayload(composerState)
    : { text: displayQuestion, segments: [], attachments: composerState.attachments || [] };
  if (!displayPayload.text && displayQuestion) displayPayload.text = displayQuestion;
  if (!livecodeProjectPath) {
    alert("Open a project folder first.");
    return;
  }
  const turnSessionId = livecodeAgentSessionId;
  if (turnSessionId) {
    delete _livecodeLastProgressSeqBySession[turnSessionId];
    delete _livecodeActiveTurnIdBySession[turnSessionId];
  }
  toggleLiveCodeAgentPane(true);
  _livecodeShowChatContainer();
  _livecodeUpdateActiveChatTabTitle(displayQuestion || question);
  _livecodeUpsertPendingSession(
    turnSessionId,
    _livecodeTruncateTabTitle(displayQuestion || question, 120)
  );
  tab.agentRunning = true;
  tab._turnStreamComplete = false;
  tab._answerStreaming = false;
  tab._assistantStreamRow = null;
  livecodeAgentRunning = true;
  renderLiveCodeRecentSessions();
  if (typeof window.clearLivecodeComposer === "function") {
    window.clearLivecodeComposer();
  }
  if (typeof window.updateLivecodeComposerSendState === "function") {
    window.updateLivecodeComposerSendState();
  }
  const out = getLiveCodeChatOutput();
  if (!out) {
    tab.agentRunning = false;
    livecodeAgentRunning = false;
    return;
  }
  _livecodeMarkChatOutputForTab(out, tab);
  const getStreamOut = function() {
    return _livecodeGetTabStreamOutput(tab) || out;
  };
  _livecodeResetTurnState();
  _livecodeClearWelcomePlaceholder(out);
  let urow = null;
  if (typeof window.renderLivecodeUserMessage === "function") {
    urow = window.renderLivecodeUserMessage(out, displayPayload);
  }
  if (!urow) {
    urow = document.createElement("div");
    urow.className = "chat-row livecode-user-row";
    urow.innerHTML = `<div class="chat-msg user"><span class="livecode-user-text">${_livecodeEscapeHtml(displayQuestion || question)}</span></div>`;
    out.appendChild(urow);
  }
  _livecodeCurrentUserRow = urow;
  _livecodeScheduleUserMessageCollapseState(out);
  _livecodeSaveTurnCtxToTab(tab);
  tab.messagesHtml = out.innerHTML;
  tab.chatStarted = true;
  _livecodeChatStarted = true;
  if (livecodeProjectPath && tab.sessionId) {
    _livecodeSaveSessionForProject(livecodeProjectPath, tab.sessionId);
  }
  _livecodeScrollChatToBottom(out);
  _setLiveCodeChatBusy(true);
  initLiveCodeAgentSocket();
  _livecodeShowImmediateThinking();
  _livecodeSaveTurnCtxToTab(tab);
  _livecodeScrollChatToBottom(out);
  let fullText = "";
  let lastRenderedAnswer = "";
  let assistantRow = null;
  const ensureAssistantRow = function() {
    const streamOut = getStreamOut();
    if (!streamOut) return null;
    if (assistantRow && assistantRow.parentNode === streamOut) {
      return assistantRow.querySelector(".livecode-stream-msg") || assistantRow.querySelector(".chat-msg.assistant");
    }
    assistantRow = document.createElement("div");
    assistantRow.className = "chat-row livecode-assistant-row";
    assistantRow.innerHTML = '<div class="chat-msg assistant livecode-stream-msg livecode-plain-msg"></div>';

    streamOut.appendChild(assistantRow);
    tab._assistantStreamRow = assistantRow;
    if (tab.id === livecodeActiveChatTabId) {
      _livecodeAssistantStreamEl = assistantRow.querySelector(".livecode-stream-msg");
    }
    return assistantRow.querySelector(".livecode-stream-msg");
  };
  const finalizeAssistantAnswerRow = function() {
    if (!assistantRow) return;
    const msgEl = assistantRow.querySelector(".chat-msg.assistant");
    if (msgEl) msgEl.classList.remove("livecode-stream-msg");
    if (tab._assistantStreamRow === assistantRow) tab._assistantStreamRow = null;
    if (_livecodeAssistantStreamEl === msgEl) _livecodeAssistantStreamEl = null;
  };
  const flushAnswerMarkdown = function() {
    const msgEl = ensureAssistantRow();
    if (msgEl) {
      _livecodeRenderAssistantMarkdown(msgEl, fullText);
      lastRenderedAnswer = fullText;
    }
    const streamOut = getStreamOut();
    if (streamOut) tab.messagesHtml = streamOut.innerHTML;
  };
  if (tab.abortController) {
    try { tab.abortController.abort(); } catch (e) {}
  }
  tab.abortController = new AbortController();
  if (tab.id === livecodeActiveChatTabId) {
    _livecodeChatAbortController = tab.abortController;
  }
  try {
    initLiveCodeAgentSocket();
    const agentSock = window._livecodeAgentSocket;
    const socketId = (agentSock && agentSock.id) || (typeof socket !== "undefined" && socket && socket.id) || "";
    const resp = await fetch("/livecode-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      signal: tab.abortController.signal,
      body: JSON.stringify({
        project_path: livecodeProjectPath,
        question: question,
        attachments: apiAttachments,
        session_id: turnSessionId,
        socket_id: socketId || undefined,
        model: typeof window.getLivecodeAiModel === "function" ? window.getLivecodeAiModel() : undefined,
        display_payload: displayPayload,
        mode: turnMode,
        plan_file: turnPlanFile || undefined,
      }),
    });
    const streamOut = getStreamOut();
    const isVisibleTab = tab.id === livecodeActiveChatTabId;
    let payload = {};
    const contentType = String(resp.headers.get("content-type") || "");
    if (contentType.indexOf("text/event-stream") >= 0 && resp.body && resp.body.getReader) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (!line.startsWith("data: ")) continue;
          let eventPayload = null;
          try {
            eventPayload = JSON.parse(line.slice(6));
          } catch (parseErr) {
            continue;
          }
          if (eventPayload.progress) {
            handleLiveCodeProgress(eventPayload.progress);
          } else if (eventPayload.command_stream) {
            _livecodeEnsureCommandStreamHandler();
            if (_livecodeCommandStreamHandler) _livecodeCommandStreamHandler(eventPayload.command_stream);
          } else if (eventPayload.error) {
            payload = eventPayload;
          } else if (eventPayload.done) {
            payload = eventPayload;
          } else if (eventPayload.meta) {
            payload = Object.assign({}, payload, eventPayload.meta);
          }
        }
      }
    } else {
      try {
        payload = await resp.json();
      } catch (jsonErr) {
        payload = { error: "LiveCode request failed." };
      }
    }
    if (!resp.ok && !payload.error) {
      payload.error = "LiveCode request failed.";
    }
    if (payload.error) {
      tab._answerStreaming = true;
      fullText = payload.error || "LiveCode request failed.";
      if (isVisibleTab) {
        _livecodeStopThinkingTicker();
        _livecodeFinalizeRunningActivity();
        _livecodeHideStatusRow();
      }
      flushAnswerMarkdown();
    } else {
      tab._answerStreaming = true;
      tab._turnStreamComplete = true;
      fullText = payload.answer || "";
      if (isVisibleTab) {
        _livecodeStopThinkingTicker();
        _livecodeFinalizeRunningActivity();
        _livecodeHideStatusRow();
      }
      if (payload.session_title) {
        _livecodeUpsertPendingSession(turnSessionId, payload.session_title);
        const titleTab = livecodeChatTabs.find(function(t) { return t.sessionId === turnSessionId; });
        if (titleTab) {
          titleTab.title = _livecodeTruncateTabTitle(payload.session_title);
        }
        if (isVisibleTab) {
          _livecodeUpdateActiveChatTabTitle(payload.session_title, true);
        }
        renderLiveCodeRecentSessions();
      }
      flushAnswerMarkdown();
      finalizeAssistantAnswerRow();
    }
    if (streamOut) {
      tab.messagesHtml = streamOut.innerHTML;
      if (tab.id === livecodeActiveChatTabId) {
        streamOut.scrollTop = streamOut.scrollHeight;
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const msgEl = ensureAssistantRow();
      if (msgEl) msgEl.textContent = "Error: " + (err.message || String(err));
      _livecodeSyncTabStreamOutput(tab);
    }
  } finally {
    if (tab.id === livecodeActiveChatTabId) {
      _livecodeStopThinkingTicker();
    }
    tab._turnStreamComplete = true;
    tab._answerStreaming = false;
    tab.abortController = null;
    tab.agentRunning = false;
    if (tab.id === livecodeActiveChatTabId) {
      _livecodeChatAbortController = null;
      _livecodeClearPendingToolSteps();
    }
    _livecodeSyncTabStreamOutput(tab);
    const persistOut = tab.id === livecodeActiveChatTabId
      ? getLiveCodeChatOutput()
      : (tab._backgroundOutput || null);
    if (persistOut) {
      _livecodeFinalizeDomForSnapshot(persistOut);
      tab.messagesHtml = persistOut.innerHTML;
    } else if (tab._backgroundOutput) {
      tab.messagesHtml = tab._backgroundOutput.innerHTML;
    }
    if (tab.messagesHtml && tab.sessionId) {
      delete _livecodeLastProgressSeqBySession[tab.sessionId];
      delete _livecodeActiveTurnIdBySession[tab.sessionId];
      tab.chatStarted = true;
      if (livecodeProjectPath) {
        _livecodeSaveSessionForProject(livecodeProjectPath, tab.sessionId);
        _livecodePersistChatSnapshot(livecodeProjectPath, tab);
      }
    }
    if (tab.id === livecodeActiveChatTabId) {
      if (fullText && _livecodeAssistantStreamEl && fullText !== lastRenderedAnswer) {
        _livecodeRenderAssistantMarkdown(_livecodeAssistantStreamEl, fullText);
        lastRenderedAnswer = fullText;
      }
      const liveOut = getLiveCodeChatOutput();
      if (liveOut) liveOut.scrollTop = liveOut.scrollHeight;
    } else {
      tab.hasUnread = true;
    }
    if (livecodeProjectPath) renderLiveCodeRecentSessions();
    _livecodeSyncGlobalRunningFromActiveTab();
    _livecodeRenderChatTabs();
  }
};

function _livecodeBindUserMessageCollapseOnce() {
  const out = getLiveCodeChatOutput();
  if (!out || out.dataset.userCollapseBound === "1") return;
  out.dataset.userCollapseBound = "1";
  out.addEventListener("click", function(e) {
    const msg = e.target && e.target.closest ? e.target.closest(".chat-row.livecode-user-row .chat-msg.user") : null;
    if (!msg) return;
    const row = msg.closest(".chat-row.livecode-user-row");
    if (!row || !row.classList.contains("is-collapsible")) return;
    row.classList.toggle("is-expanded");
  });
}

document.addEventListener("DOMContentLoaded", function() {
  const el = document.getElementById("livecode-chat-input");
  _livecodeBindChatScrollWheel();
  _livecodeBindUserMessageCollapseOnce();
  if (!el) return;

  (function() {
    const approve = document.getElementById("livecode-permission-toolbar-approve");
    const deny = document.getElementById("livecode-permission-toolbar-deny");
    if (!approve || !deny) return;

    function submit(approved) {
      if (!_livecodePendingPermissionRequestId) return;
      _livecodeResolvePermissionRequest(_livecodePendingPermissionRequestId, approved);
    }

    approve.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      submit(true);
    });
    deny.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      submit(false);
    });

    _livecodeSetPermissionToolbarVisible(false);
  })();

  if (typeof window.initLivecodeComposerInput === "function") {
    window.initLivecodeComposerInput();
  }
});

window.livecodeChatMode = localStorage.getItem(LIVECODE_CHAT_MODE_STORAGE_KEY) || "agent";

function _livecodeApplyChatModeToUI() {
  const modeDef = LIVECODE_CHAT_MODES.find(function(m) {
    return m.value === window.livecodeChatMode;
  }) || LIVECODE_CHAT_MODES[0];
  const trigger = document.querySelector("[data-livecode-mode-trigger]");
  if (trigger) trigger.setAttribute("data-mode", modeDef.value);
  const label = document.querySelector("[data-livecode-mode-label]");
  if (label) label.textContent = modeDef.label;
  const iconEl = document.querySelector(".chatbot-composer-mode-icon");
  if (iconEl) {
    iconEl.outerHTML = _livecodeGetModeIconHtml(modeDef.value, "chatbot-composer-mode-icon");
  }
  const input = document.getElementById("livecode-chat-input");
  if (input) {
    var placeholder = modeDef.placeholder || "Build, fix, or explain...";
    if ("placeholder" in input) {
      input.placeholder = placeholder;
    }
    input.setAttribute("data-placeholder", placeholder);
  }
}

function _livecodeEnsureModeDropdown() {
  let el = document.getElementById("livecode-chat-mode-dropdown");
  if (el) {
    if (el.style.position !== "fixed") {
      el.setAttribute("style", _LIVECODE_MODE_DROPDOWN_STYLE);
    }
    return el;
  }
  el = document.createElement("div");
  el.id = "livecode-chat-mode-dropdown";
  el.className = "airflow-dropdown-opaque chatbot-model-dropdown livecode-chat-mode-dropdown";
  el.setAttribute("style", _LIVECODE_MODE_DROPDOWN_STYLE);
  el.setAttribute("role", "listbox");
  el.setAttribute("aria-label", "Select mode");
  el.innerHTML =
    '<div id="livecode-chat-mode-dropdown-list" class="chatbot-model-dropdown-list" style="flex:1;overflow-y:auto;max-height:320px;"></div>';
  document.body.appendChild(el);
  return el;
}

function _livecodeRenderModeDropdownList() {
  const list = document.getElementById("livecode-chat-mode-dropdown-list");
  if (!list) return;
  const checkSvg =
    '<svg class="livecode-mode-dropdown-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="20 6 9 17 4 12"></polyline></svg>';
  list.innerHTML = LIVECODE_CHAT_MODES.map(function(mode) {
    const isSelected = mode.value === window.livecodeChatMode;
    return (
      '<div class="chatbot-model-dropdown-item livecode-mode-dropdown-item theme-transition' +
      (isSelected ? " is-selected" : "") +
      '" data-mode-value="' + mode.value + '" role="option" aria-selected="' + (isSelected ? "true" : "false") + '">' +
      '<span class="livecode-mode-dropdown-item-icon">' + _livecodeGetModeIconHtml(mode.value) + "</span>" +
      "<span>" + mode.label + "</span>" +
      checkSvg +
      "</div>"
    );
  }).join("");
  list.querySelectorAll(".livecode-mode-dropdown-item").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      const nextMode = item.getAttribute("data-mode-value");
      if (!nextMode) return;
      window.livecodeChatMode = nextMode;
      localStorage.setItem(LIVECODE_CHAT_MODE_STORAGE_KEY, nextMode);
      _livecodeApplyChatModeToUI();
      window.closeLivecodeModeDropdown();
      _livecodeRenderModeDropdownList();
    });
  });
}

window.closeLivecodeModeDropdown = function() {
  const dropdown = document.getElementById("livecode-chat-mode-dropdown");
  const trigger = document.querySelector("[data-livecode-mode-trigger]");
  if (dropdown) dropdown.style.display = "none";
  if (trigger) {
    trigger.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }
};

window.toggleLivecodeModeDropdown = function(trigger) {
  const dropdown = _livecodeEnsureModeDropdown();
  if (!dropdown || !trigger) return;
  const wasOpen = dropdown.style.display === "flex" && trigger.classList.contains("is-open");
  window.closeLivecodeModeDropdown();
  if (wasOpen) return;
  if (typeof window.closeChatbotModelDropdown === "function") {
    window.closeChatbotModelDropdown();
  }
  _livecodeRenderModeDropdownList();
  const rect = trigger.getBoundingClientRect();
  dropdown.style.display = "flex";
  dropdown.style.left = rect.left + "px";
  dropdown.style.minWidth = Math.max(rect.width, 180) + "px";
  dropdown.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  dropdown.style.zIndex = "10050";
  trigger.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
};

let _livecodeModeSelectorBound = false;

window.initLivecodeModeSelector = function() {
  _livecodeApplyChatModeToUI();
  if (_livecodeModeSelectorBound) return;
  const trigger = document.querySelector("[data-livecode-mode-trigger]");
  if (!trigger) return;
  _livecodeModeSelectorBound = true;
  _livecodeEnsureModeDropdown();
  trigger.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.toggleLivecodeModeDropdown(trigger);
  });
  trigger.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      window.toggleLivecodeModeDropdown(trigger);
    }
  });
  if (!window._livecodeModeDropdownGlobalBound) {
    window._livecodeModeDropdownGlobalBound = true;
    document.addEventListener("click", function(e) {
      const dropdown = document.getElementById("livecode-chat-mode-dropdown");
      if (!dropdown || dropdown.style.display !== "flex") return;
      if (e.target.closest("#livecode-chat-mode-dropdown") || e.target.closest("[data-livecode-mode-trigger]")) return;
      window.closeLivecodeModeDropdown();
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") window.closeLivecodeModeDropdown();
    });
  }
};

(function() {
  let isResizingSidebar = false;
  let startX = 0;
  let rafId = null;
  const divider = document.getElementById("ide-sidebar-divider");
  const handle = document.getElementById("ide-sidebar-divider-handle");
  const sidebar = document.getElementById("ide-sidebar");
  if (!divider || !sidebar) return;
  divider.onmousedown = function(e) {
    if (e.button !== 0) return;
    isResizingSidebar = true;
    startX = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    sidebar.style.transition = "none";
    e.preventDefault();
  };
  const handleSidebarMove = function(e) {
    if (!isResizingSidebar) return;
    if (rafId) cancelAnimationFrame(rafId);
    const container = divider.parentElement;
    const containerRect = container.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const newWidth = Math.max(150, Math.min(500, mouseX - 48));
    rafId = requestAnimationFrame(() => {
      sidebar.style.width = newWidth + "px";
      rafId = null;
    });
    e.preventDefault();
  };
  const stopSidebarResizing = function() {
    if (!isResizingSidebar) return;
    isResizingSidebar = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    sidebar.style.transition = "";
  };
  document.addEventListener("mousemove", handleSidebarMove, { passive: false });
  document.addEventListener("mouseup", stopSidebarResizing);
})();

(function() {
  let isResizingTerminal = false;
  let rafId = null;
  const divider = document.getElementById("ide-terminal-divider");
  const terminalPanel = document.getElementById("ide-terminal-panel");
  const mainContainer = document.getElementById("ide-main-container");
  if (!divider || !terminalPanel || !mainContainer) return;
  divider.onmousedown = function(e) {
    if (e.button !== 0) return;
    isResizingTerminal = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    terminalPanel.style.transition = "none";
    e.preventDefault();
  };
  const handleTerminalMove = function(e) {
    if (!isResizingTerminal) return;
    if (rafId) cancelAnimationFrame(rafId);
    const containerRect = mainContainer.getBoundingClientRect();
    const mouseY = e.clientY - containerRect.top;
    const newHeight = Math.max(100, Math.min(containerRect.height - 100, containerRect.height - mouseY));
    rafId = requestAnimationFrame(() => {
      terminalPanel.style.height = newHeight + "px";
      if (ideFitAddon) try { ideFitAddon.fit(); } catch (e) {}
      rafId = null;
    });
    e.preventDefault();
  };
  const stopTerminalResizing = function() {
    if (!isResizingTerminal) return;
    isResizingTerminal = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    terminalPanel.style.transition = "";
  };
  document.addEventListener("mousemove", handleTerminalMove, { passive: false });
  document.addEventListener("mouseup", stopTerminalResizing);
})();

(function() {
  let isResizingAgent = false;
  let rafId = null;
  const LIVECODE_AGENT_DEFAULT_WIDTH = 420;
  const divider = document.getElementById("ide-agent-divider");
  const agentPanel = document.getElementById("livecode-agent-panel");
  if (!divider || !agentPanel) return;
  agentPanel.style.width = LIVECODE_AGENT_DEFAULT_WIDTH + "px";
  window._livecodeAgentDefaultWidthApplied = true;
  divider.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    isResizingAgent = true;
    const startX = e.clientX;
    const startW = agentPanel.offsetWidth;
    divider.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    agentPanel.style.transition = "none";
    function onMove(ev) {
      if (!isResizingAgent) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(function() {
        const w = startW - (ev.clientX - startX);
        const parent = agentPanel.parentElement;
        const maxW = parent ? Math.floor(parent.getBoundingClientRect().width * 0.7) : 1000;
        if (w >= 280 && w <= maxW) agentPanel.style.width = w + "px";
        rafId = null;
      });
      ev.preventDefault();
    }
    function onUp() {
      if (!isResizingAgent) return;
      isResizingAgent = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      divider.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      agentPanel.style.transition = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (window.ideEditor) {
        setTimeout(function() { try { window.ideEditor.layout(); } catch (_) {} }, 50);
      }
    }
    document.addEventListener("mousemove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
})();
