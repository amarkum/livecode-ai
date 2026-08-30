/**
 * Markdown preview + PDF export (ported from xenfile / mdpdf).
 * https://github.com/amarkum/xenfile
 */
(function () {
  "use strict";

  var PDF_MARGIN_MM = 10;
  var PDF_CONTENT_WIDTH_PX = 720;

  var mermaidCounter = 0;
  var mermaidRenderQueue = Promise.resolve();
  var mermaidInitialized = false;

  function decodeHtmlEntities(text) {
    return String(text || "")
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  var EMOJI_ONLY = /^(\p{Extended_Pictographic}|\u200d|\ufe0f|\s)+$/u;

  function unwrapEmojiOnlyCode(html) {
    return html.replace(/<code>([^<]+)<\/code>/g, function (match, content) {
      var stripped = String(content || "").trim();
      return stripped && EMOJI_ONLY.test(stripped) ? stripped : match;
    });
  }

  function ensureMermaidInitialized() {
    if (mermaidInitialized || typeof mermaid === "undefined") return;
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "loose",
      htmlLabels: false,
      useMaxWidth: false,
      flowchart: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: true },
      themeVariables: {
        primaryColor: "#ececff",
        primaryTextColor: "#1f2937",
        primaryBorderColor: "#9370db",
        lineColor: "#374151",
        secondaryColor: "#f4f4f4",
        tertiaryColor: "#ffffff",
      },
    });
    mermaidInitialized = true;
  }

  function markdownToPreviewHtml(markdown, idPrefix) {
    var md = String(markdown || "");
    var prefix = String(idPrefix || "mdpdf-mermaid-");
    var html = typeof marked !== "undefined" ? marked.parse(md) : md;

    html = html.replace(
      /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
      function (_match, code) {
        var decoded = decodeHtmlEntities(code);
        var id = prefix + Math.random().toString(36).slice(2, 11);
        var encoded = encodeURIComponent(decoded);
        return (
          '<div class="mermaid-container"><div class="mermaid" id="' +
          id +
          '" data-mermaid-source="' +
          encoded +
          '">' +
          decoded +
          "</div></div>"
        );
      }
    );

    html = unwrapEmojiOnlyCode(html);

    if (typeof DOMPurify !== "undefined") {
      return DOMPurify.sanitize(html, {
        ADD_TAGS: ["foreignObject"],
        ADD_ATTR: ["data-mermaid-source", "id"],
      });
    }
    return html;
  }

  function getMermaidSource(element) {
    var stored = element.dataset.mermaidSource;
    if (stored) {
      try {
        return decodeHtmlEntities(decodeURIComponent(stored));
      } catch (e) {
        return decodeHtmlEntities(stored);
      }
    }
    if (element.querySelector("svg")) return "";
    var source = (element.textContent || "").trim();
    if (source) {
      element.dataset.mermaidSource = encodeURIComponent(source);
    }
    return source;
  }

  function encodedSource(code) {
    return encodeURIComponent(code);
  }

  function isAlreadyRendered(element, code, force) {
    if (force) return false;
    if (element.dataset.mermaidSource !== encodedSource(code)) return false;
    if (element.querySelector("p[style*='color:#ef4444']")) return false;
    return Boolean(element.querySelector("svg"));
  }

  function cleanupOrphanedMermaidSvgs() {
    document.body.querySelectorAll('svg[id^="mdpdf-mermaid-"]').forEach(function (el) {
      if (el.parentElement === document.body) el.remove();
    });
  }

  function ensureSvgDimensions(svg) {
    if (svg.hasAttribute("width") && svg.hasAttribute("height")) return;
    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width && vb.height) {
      svg.setAttribute("width", String(vb.width));
      svg.setAttribute("height", String(vb.height));
    }
  }

  function enqueueMermaidRender(fn) {
    var run = mermaidRenderQueue.then(fn, fn);
    mermaidRenderQueue = run.then(
      function () {},
      function () {}
    );
    return run;
  }

  function renderOneMermaid(element, code, isStale, options) {
    ensureMermaidInitialized();
    if (typeof mermaid === "undefined") {
      element.innerHTML =
        '<p style="color:#ef4444;padding:12px;background:#fee;border:1px solid #fcc;border-radius:4px;">Mermaid is not loaded.</p>';
      return Promise.resolve();
    }

    element.dataset.mermaidSource = encodedSource(code);
    var svgId = "mdpdf-mermaid-" + ++mermaidCounter;

    return enqueueMermaidRender(function () {
      return mermaid.render(svgId, code, element).then(
        function (result) {
          if (isStale && isStale()) return;
          if (!options || !options.allowDetached) {
            if (!element.isConnected) return;
          }
          element.innerHTML = result.svg;
          if (typeof result.bindFunctions === "function") {
            result.bindFunctions(element);
          }
          var svg = element.querySelector("svg");
          if (svg) ensureSvgDimensions(svg);
        },
        function (err) {
          if (isStale && isStale()) return;
          if (!options || !options.allowDetached) {
            if (!element.isConnected) return;
          }
          var message = err && err.message ? err.message : String(err || "Unknown error");
          element.innerHTML =
            '<p style="color:#ef4444;padding:12px;background:#fee;border:1px solid #fcc;border-radius:4px;">Mermaid error: ' +
            message +
            "</p>";
        }
      );
    });
  }

  function renderMermaidDiagrams(container, isStale, options) {
    if (!container) return Promise.resolve();
    cleanupOrphanedMermaidSvgs();

    var elements = container.querySelectorAll(".mermaid");
    var chain = Promise.resolve();

    elements.forEach(function (element) {
      chain = chain.then(function () {
        if (isStale && isStale()) return;
        var code = getMermaidSource(element);
        if (!code) return;
        if (isAlreadyRendered(element, code, options && options.force)) return;
        return renderOneMermaid(element, code, isStale, options);
      });
    });

    return chain.then(function () {
      cleanupOrphanedMermaidSvgs();
    });
  }

  function waitForLayout() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  function prepareElementForPdfExport(root) {
    root.style.overflow = "visible";
    root.style.height = "auto";
    root.style.maxHeight = "none";
    root.style.width = PDF_CONTENT_WIDTH_PX + "px";
    root.style.boxSizing = "border-box";

    root.querySelectorAll(".mermaid-container").forEach(function (container) {
      container.style.overflow = "visible";
      container.style.overflowX = "visible";
      container.style.maxWidth = "100%";
      container.style.pageBreakInside = "auto";
      container.style.breakInside = "auto";
    });

    root.querySelectorAll(".mermaid").forEach(function (node) {
      node.style.overflow = "visible";
      node.style.maxWidth = "100%";
    });

    var maxSvgWidth = PDF_CONTENT_WIDTH_PX - 48;

    root.querySelectorAll(".mermaid svg").forEach(function (svg) {
      var viewBox = svg.viewBox && svg.viewBox.baseVal;
      var attrWidth = Number(svg.getAttribute("width"));
      var attrHeight = Number(svg.getAttribute("height"));
      var rect = svg.getBoundingClientRect();
      var naturalWidth = (viewBox && viewBox.width) || attrWidth || rect.width;
      var naturalHeight = (viewBox && viewBox.height) || attrHeight || rect.height;
      if (!naturalWidth || !naturalHeight) return;

      svg.style.overflow = "visible";
      svg.style.maxWidth = "none";

      if (naturalWidth > maxSvgWidth) {
        var scale = maxSvgWidth / naturalWidth;
        var width = Math.round(naturalWidth * scale);
        var height = Math.round(naturalHeight * scale);
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.style.width = width + "px";
        svg.style.height = height + "px";
        return;
      }

      svg.setAttribute("width", String(Math.round(naturalWidth)));
      svg.setAttribute("height", String(Math.round(naturalHeight)));
      svg.style.width = Math.round(naturalWidth) + "px";
      svg.style.height = Math.round(naturalHeight) + "px";
    });

    root.querySelectorAll("pre").forEach(function (pre) {
      pre.style.overflow = "visible";
      pre.style.whiteSpace = "pre-wrap";
      pre.style.wordBreak = "break-word";
    });

    root.querySelectorAll("table").forEach(function (table) {
      table.style.tableLayout = "fixed";
      table.style.width = "100%";
      table.style.wordBreak = "break-word";
    });
  }

  function mountPdfExportClone(preview) {
    var clone = preview.cloneNode(true);
    clone.classList.add("mdpdf-pdf-export", "mdpdf-preview-body");
    prepareElementForPdfExport(clone);

    var host = document.createElement("div");
    host.className = "mdpdf-pdf-render-host";
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = PDF_CONTENT_WIDTH_PX + "px";
    host.style.background = "#ffffff";
    host.style.overflow = "visible";
    host.style.zIndex = "-1";
    host.style.pointerEvents = "none";
    host.appendChild(clone);
    document.body.appendChild(host);

    return waitForLayout().then(function () {
      return { host: host, clone: clone };
    });
  }

  function pdfHtml2CanvasOptions(clone) {
    var width = Math.max(clone.scrollWidth, PDF_CONTENT_WIDTH_PX);
    var height = Math.max(clone.scrollHeight, clone.offsetHeight);
    return {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: 0,
      width: width,
      height: height,
      windowWidth: width,
      windowHeight: height,
    };
  }

  var PDF_EXPORT_OPTIONS = {
    margin: PDF_MARGIN_MM,
    filename: "document.pdf",
    image: { type: "jpeg", quality: 0.98 },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["css", "legacy"] },
  };

  window.renderMarkdownLikeMdpdfPreview = function (el, markdown, mermaidPrefix) {
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
      el.innerHTML = markdownToPreviewHtml(md, mermaidPrefix || "mdpdf-mermaid-");

      if (typeof window._decorateCodeBlocksGlobal === "function") {
        window._decorateCodeBlocksGlobal(el, { livecode: true });
      }
      if (typeof window._decorateChatLinksGlobal === "function") {
        window._decorateChatLinksGlobal(el);
      }
    } catch (e) {
      el.innerHTML =
        '<p style="color:#ef4444;">Error rendering markdown: ' +
        String((e && e.message) || e) +
        "</p>";
      return Promise.resolve();
    }

    return renderMermaidDiagrams(el);
  };

  window.downloadMarkdownAsPdf = function (previewElement, filename) {
    if (!previewElement) return Promise.resolve();
    if (typeof html2pdf === "undefined") {
      var msg = "PDF export library is not loaded.";
      if (typeof window.showToast === "function") window.showToast(msg);
      else window.alert(msg);
      return Promise.reject(new Error(msg));
    }

    var savedBodyOverflow = document.body.style.overflow;
    var savedHtmlOverflow = document.documentElement.style.overflow;
    var exportName = String(filename || "document.pdf");

    return renderMermaidDiagrams(previewElement)
      .then(function () {
        return mountPdfExportClone(previewElement);
      })
      .then(function (mounted) {
        var renderHost = mounted.host;
        var clone = mounted.clone;
        var canvasOpts = pdfHtml2CanvasOptions(clone);
        var options = Object.assign({}, PDF_EXPORT_OPTIONS, {
          filename: exportName,
          html2canvas: canvasOpts,
        });

        return html2pdf()
          .set(options)
          .from(clone)
          .save()
          .then(function () {
            renderHost.remove();
          })
          .catch(function (err) {
            renderHost.remove();
            throw err;
          });
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : "Try again or use another browser.";
        if (typeof window.showToast === "function") {
          window.showToast("Download failed. " + message);
        } else {
          window.alert("Download failed. " + message);
        }
        throw err;
      })
      .finally(function () {
        document.body.style.overflow = savedBodyOverflow;
        document.documentElement.style.overflow = savedHtmlOverflow;
      });
  };

  window.renderMermaidDiagramsInElement = renderMermaidDiagrams;
})();
