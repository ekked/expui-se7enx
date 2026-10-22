/*!
 * Exponential UI (expui) autosave — drafts saved while editing, and the draft's preview.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::autosave after exp::core. The admin's and ezwebin's autosave and the admin preview
 * (Y.eZ.ContentPreview) of the ezautosave extension with the same configuration, events and markup, so its
 * templates move over by changing the constructors:
 *
 *   var as = new Exp.autosave.AutoSubmit({
 *       form: '#editform',              the form to save
 *       action: '/ezjscore/call/ezautosave::savedraft::…',   where to POST it (with its fields and files)
 *       interval: 300,                  seconds between two saves
 *       trackUserInput: true,           also save when a field loses the focus
 *       ignoreClass: 'no-autosave',     fields with this class do not count as a change
 *       enabled: function () { return true; },  asked when the page is ready
 *       beforeSerialize: function () {}  before each save reads the form; default: TinyMCE's triggerSave()
 *   });
 *   as.on('init' | 'beforesave' | 'success' | 'error' | 'abort' | 'nochange', function (e) { e.json … });
 *   as.start(); as.stop(); as.submit(extraFields);
 *   Exp.emit('autosubmit:forcesave')    saves now (the preview does this when it opens on unsaved changes)
 *
 *   var preview = new Exp.autosave.Preview({ texts: {loading, error, preview}, topPosition: '42px' });
 *   preview.init(); preview.loading(); preview.setContent(html); preview.error(text); preview.close();
 *
 * $(form).expAutosave(conf) and $(el).expPreview(conf) do the same with form / buttonPlace = that element.
 *
 * Without jQuery it runs on plain JavaScript: the draft is posted through fetch (Exp.util.request(): the same
 * address, method, FormData, form token and Accept and X-Requested-With headers), the animations through
 * Exp.util.animate(), and the preview's parts are elements (preview.linkElement, .placeElement, .previewElement).
 * With jQuery 4 on the page it runs on it, exactly as before: $.ajax(), its listeners, .animate(), .fadeIn(),
 * .html(), and the preview's link, place and preview in jQuery.
 */
(function (window, document) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.config || !Exp.util) { return; }
    if (Exp.autosave && Exp.autosave.install) {
        // loaded twice: the first copy stays, with its instances
        Exp.autosave.install(Exp.$);
        return;
    }
    var util = Exp.util;

    // ---- the DOM, with jQuery where the page has it ---------------------------------------------------------

    /** Elements: a selector, an element, a list or jQuery; through jQuery when there is one (its selectors). */
    function nodes(jq, target) {
        if (jq) { return jq(target).toArray(); }
        if (!target) { return []; }
        if (typeof target === 'string') { return Array.prototype.slice.call(document.querySelectorAll(target)); }
        return target.nodeType ? [target] : Array.prototype.slice.call(target);
    }
    function children(el) { return el ? Array.prototype.slice.call(el.children) : []; }

    /**
     * A listener: through jQuery when there is one (namespaced, so .trigger() reaches it), else as jQuery would
     * bind it: a selector delegates, this is the matched element.
     */
    function listen(jq, el, type, selector, fn) {
        if (jq) { jq(el).on(type, selector || null, fn); return; }
        el.addEventListener(type.split('.')[0], selector ? function (e) {
            for (var cur = e.target; cur && cur !== el; cur = cur.parentNode) {
                if (cur.nodeType === 1 && cur.matches(selector)) { fn.call(cur, e); return; }
            }
        } : fn);
    }
    function ready(jq, fn) { if (jq) { jq(fn); } else { Exp.ready(fn); } }
    /** .stop(true).animate(props, ms[, done]) */
    function animate(jq, el, props, ms, done) {
        if (!el) { return; }
        if (jq) { jq(el).stop(true).animate(props, ms, done); return; }
        util.stop(el);
        util.animate(el, props, ms, done);
    }

    // ---- the form's state, as ezautosubmit.js serialised it (fields with ignoreClass left out) -------------------

    function serializeForm(form, ignoreClass) {
        var data = [], enc = encodeURIComponent, searchClass = ' ' + ignoreClass + ' ', f = nodes(Exp.$ || null, form)[0];
        if (!f) { return ''; }
        for (var i = 0; i < f.elements.length; i++) {
            var e = f.elements[i], n, v, o, j;
            if (ignoreClass && (' ' + e.className + ' ').indexOf(searchClass) > -1) { continue; }
            n = enc(e.name) + '=';
            v = enc(e.value);
            switch (e.type) {
                case 'select-one':
                    if (e.selectedIndex > -1) {
                        o = e.options[e.selectedIndex];
                        data.push(n + enc(o.attributes.value && o.attributes.value.specified ? o.value : o.text));
                    }
                    break;
                case 'select-multiple':
                    if (e.selectedIndex > -1) {
                        for (j = e.selectedIndex; j < e.options.length; ++j) {
                            o = e.options[j];
                            if (o.selected) { data.push(n + enc(o.attributes.value && o.attributes.value.specified ? o.value : o.text)); }
                        }
                    }
                    break;
                case 'radio':
                case 'checkbox':
                    if (e.checked) { data.push(n + v); }
                    break;
                case undefined:
                case 'reset':
                case 'button':
                    break;
                default:
                    data.push(n + v);
            }
        }
        return data.join('&');
    }

    // ---- AutoSubmit -----------------------------------------------------------------------------------------

    var defaultConfig = {
        interval: 300, trackUserInput: true, ignoreClass: false,
        // the rich text editors (TinyMCE) save into their textareas before the form is read
        beforeSerialize: function () { if (window.tinyMCE && typeof window.tinyMCE.triggerSave === 'function') { window.tinyMCE.triggerSave(); } }
    };
    var instances = {};

    /** conf: see the header; jq: the jQuery it runs on (default Exp.$; null: none). */
    function AutoSubmit(conf, jq) {
        var self = this, enabledCheck = conf.enabled || function () { return true; };
        this.jq = jq = jq === undefined ? (Exp.$ || null) : jq;
        this.conf = util.extend({}, defaultConfig, conf);
        this.conf.interval = parseInt(this.conf.interval, 10) || defaultConfig.interval;
        this.timer = false;
        this.started = false;
        this.state = '';
        this.request = false;
        this.handlers = {};
        this.isEnabled = false;
        var form = nodes(jq, this.conf.form)[0];
        ready(jq, function () {
            self.isEnabled = !!enabledCheck.call(self);
            if (self.isEnabled) { self.fire('init'); }
        });
        Exp.on('autosubmit:forcesave', function () { self.submit('AutoSubmitForced=' + new Date().getTime()); });
        if (form && form.id) { instances[form.id] = this; }
    }

    AutoSubmit.prototype.on = function (name, fn) {
        (this.handlers[name] = this.handlers[name] || []).push(fn);
        return this;
    };

    AutoSubmit.prototype.fire = function (name, data) {
        var self = this, e = util.extend({ type: name }, data || {});
        (this.handlers[name] || []).slice().forEach(function (fn) { fn.call(self, e); });
        Exp.emit('exp:autosave:' + name, util.extend({ form: nodes(this.jq, this.conf.form)[0] }, data || {}));
    };

    /** Starts it: the form's state now, a save every interval, on leaving a field, and none once the form is submitted. */
    AutoSubmit.prototype.start = function () {
        var self = this, jq = this.jq;
        if (this.started) { return; }
        ready(jq, function () {
            if (!self.isEnabled || self.started) { return; }
            self.timer = window.setInterval(function () { self.submit(); }, self.conf.interval * 1000);
            self.started = true;
            self.state = serializeForm(self.conf.form, self.conf.ignoreClass);
            nodes(jq, self.conf.form).forEach(function (form) {
                if (self.conf.trackUserInput) {
                    // a delegated 'blur' (focusout is the bubbling one)
                    listen(jq, form, 'focusout.expautosave', 'input, select, textarea, iframe', function (e) {
                        if (!self.conf.ignoreClass || !(e.target.classList && e.target.classList.contains(self.conf.ignoreClass))) { self.submit(); }
                    });
                }
                listen(jq, form, 'submit.expautosave', null, function () { self.stop(); });
            });
        });
    };

    /** Stops it, and cancels a save on its way (which fires 'abort'). */
    AutoSubmit.prototype.stop = function () {
        if (!this.started) { return; }
        window.clearInterval(this.timer);
        this.started = false;
        if (this.request) {
            var r = this.request;
            this.request = false;
            r.abort();
        }
    };

    /**
     * Saves the form when it changed since the last save: its fields and files, posted to conf.action. fields: more
     * data to send, as "name=value&name=value" (it also counts as a change).
     */
    AutoSubmit.prototype.submit = function (fields) {
        var self = this, jq = this.jq, formState, originalState, form = nodes(jq, this.conf.form)[0];
        if (!this.started) { return; }
        // Rich text editors write their content back into the form first, as the form's own submit makes them do
        // (TinyMCE patches form.submit()), so the draft gets what the editor
        // shows and the next comparison does not see a change that is only the editor's rewrite
        if (this.conf.beforeSerialize) { this.conf.beforeSerialize.call(this); }
        formState = originalState = serializeForm(this.conf.form, this.conf.ignoreClass);
        if (fields) { formState += '&' + fields; }
        if (this.state === formState) {
            this.fire('nochange');
            return;
        }
        if (this.request) {
            var old = this.request;
            this.request = false;
            old.expReplaced = true;
            old.abort();
        }
        this.state = originalState;
        this.fire('beforesave');
        var data = new FormData(form);
        if (fields) {
            String(fields).split('&').forEach(function (pair) {
                if (!pair) { return; }
                var i = pair.indexOf('=');
                data.append(decodeURIComponent(i === -1 ? pair : pair.slice(0, i)), i === -1 ? '' : decodeURIComponent(pair.slice(i + 1)));
            });
        }
        if (!data.has('ezxform_token') && Exp.token()) { data.append('ezxform_token', Exp.token()); }
        // the answer as text, with the Accept header jQuery sends for it
        var request = jq ? jq.ajax({ url: this.conf.action, method: 'POST', data: data, processData: false, contentType: false, dataType: 'text' })
                         : util.request({ url: this.conf.action, method: 'POST', data: data, dataType: 'text', headers: { Accept: 'text/plain, */*; q=0.01' } });
        this.request = request;
        request.then(function (text) {
            if (self.request === request) { self.request = false; }
            var json = null, error = false;
            try { json = JSON.parse(text); } catch (e) { error = true; }
            if (error || !json || json.error_text) {
                self.fire('error', { json: json });
            } else {
                self.fire('success', { json: json });
            }
        }, function (xhr, textStatus) {
            if (self.request === request) { self.request = false; }
            if ((textStatus === undefined && xhr ? xhr.textStatus : textStatus) === 'abort') {
                // an aborted save (stop(), or a newer save replacing it) reports 'abort'
                if (!request.expReplaced) { self.fire('abort'); }
                return;
            }
            var json = null;
            try { json = JSON.parse(xhr.responseText); } catch (e) { json = null; }
            self.fire('error', { json: json });
        });
    };

    // ---- Preview ----------------------------------------------------------------------------------------------

    var previewDefaults = {
        previewTemplate: '<div id="content-preview" class="unsaved"><div id="preview-iframe"></div><div class="loader">%loading</div><div class="error">%error</div></div>',
        elementTemplate: '<a id="preview-spacer"><span>%preview</span></a><a id="preview-link"><span>%preview</span></a>',
        place: '#content-preview',
        preview: '#preview-iframe',
        element: '#preview-link',
        buttonPlace: '#controlbar-top .button-right',
        texts: { loading: 'Loading...', preview: 'Preview', error: 'An error occurred' },
        topPosition: '0px'
    };

    function esc(s) { var span = document.createElement('span'); span.textContent = String(s); return span.innerHTML; }

    /** conf: see the header; jq: the jQuery it runs on (default Exp.$; null: none). */
    function Preview(conf, jq) {
        this.jq = jq === undefined ? (Exp.$ || null) : jq;
        this.conf = util.extend(true, {}, previewDefaults, conf);
        var c = this.conf;
        c.previewTemplate = c.previewTemplate.replace('%loading', esc(c.texts.loading)).replace('%error', esc(c.texts.error));
        c.elementTemplate = c.elementTemplate.replace(/%preview/g, esc(c.texts.preview));
    }

    Preview.prototype.init = function () {
        var self = this, jq = this.jq, c = this.conf;
        nodes(jq, c.buttonPlace).forEach(function (place) {
            place.insertAdjacentHTML('beforeend', c.elementTemplate);
            place.insertAdjacentHTML('beforeend', c.previewTemplate);
        });
        this.linkElement = nodes(jq, c.element)[0] || null;
        this.placeElement = nodes(jq, c.place)[0] || null;
        this.previewElement = nodes(jq, c.preview)[0] || null;
        // in jQuery as before, for code that reads them there
        if (jq) {
            this.link = jq(c.element);
            this.place = jq(c.place);
            this.preview = jq(c.preview);
        }
        if (this.linkElement) { util.css(this.linkElement, 'height', c.topPosition); }
        if (this.placeElement) { util.css(this.placeElement, 'top', c.topPosition); }
        this.collapsible = new Exp.collapse.Collapse({
            link: c.element,
            content: false,
            collapsed: 1,
            beforeuncollapse: function () { self.initPreview(); },
            aftercollapse: function () { self.resetPreview(); },
            beforecollapse: function () {
                // as ezcontentpreview.js: the contents fade out while the place closes
                children(self.placeElement).forEach(function (child) { animate(jq, child, { opacity: 0 }, Exp.reducedMotion ? 0 : 500); });
            },
            elements: [{
                selector: c.place, duration: 0.7,
                fullStyle: { height: function () { return (window.innerHeight - parseInt(self.conf.topPosition, 10)) + 'px'; } },
                collapsedStyle: { height: '0px' }
            }, {
                selector: c.place + ' iframe', duration: 0.8,
                fullStyle: { height: function () { return self.getIframeHeight(); } },
                collapsedStyle: { height: '0px' }
            }]
        }, jq);
        this.loading();
    };

    Preview.prototype.close = function () { this.collapsible.collapse(); };

    Preview.prototype.loading = function () {
        if (!this.placeElement) { return; }
        this.placeElement.classList.remove('error');
        this.placeElement.classList.add('loading');
    };

    /** The iframe in the preview place, or null. */
    Preview.prototype.iframe = function () { return this.placeElement ? this.placeElement.querySelector('iframe') : null; };

    /** The height that makes the iframe fill the preview place, as "300px". */
    Preview.prototype.getIframeHeight = function () {
        var offset = 0, iframe = this.iframe();
        children(this.previewElement).forEach(function (child) {
            if (child.tagName.toLowerCase() !== 'iframe') { offset += child.offsetHeight; }
        });
        var cs = iframe ? window.getComputedStyle(iframe) : { marginTop: '0', marginBottom: '0' };
        return (window.innerHeight - parseInt(this.conf.topPosition, 10) - offset
                - (parseInt(cs.marginTop, 10) || 0) - (parseInt(cs.marginBottom, 10) || 0)) + 'px';
    };

    Preview.prototype.initPreview = function () {
        var jq = this.jq, place = this.placeElement;
        if (this.linkElement) { this.linkElement.classList.add('previewed'); }
        if (!place) { return; }
        place.classList.add('previewed');
        children(place).forEach(function (child) {
            if (jq) { jq(child).stop(true).css('opacity', 1); } else { util.stop(child); util.css(child, 'opacity', 1); }
        });
        if (place.classList.contains('unsaved') || place.classList.contains('error')) {
            place.classList.remove('unsaved');
            Exp.emit('autosubmit:forcesave');
        }
    };

    Preview.prototype.resetPreview = function () {
        var jq = this.jq;
        if (this.linkElement) { this.linkElement.classList.remove('previewed'); }
        if (!this.placeElement) { return; }
        this.placeElement.classList.remove('previewed');
        children(this.placeElement).forEach(function (child) {
            if (jq) { jq(child).stop(true).css('opacity', 1); } else { util.stop(child); util.css(child, 'opacity', 1); }
        });
    };

    /** The preview's content (HTML from the server: the iframe and its toolbar). */
    Preview.prototype.setContent = function (content) {
        if (!this.placeElement) { return; }
        this.placeElement.classList.remove('loading');
        if (this.previewElement) {
            if (this.jq) { this.jq(this.previewElement).html(content); } else { this.previewElement.innerHTML = content; }
        }
        this.setHandlers();
        if (this.placeElement.classList.contains('previewed')) {
            animate(this.jq, this.iframe(), { height: this.getIframeHeight() }, Exp.reducedMotion ? 0 : 400);
        }
    };

    Preview.prototype.error = function (err) {
        var msg = this.conf.texts.error;
        if (err) { msg += ': ' + err; }
        if (!this.placeElement) { return; }
        var box = this.placeElement.querySelector('.error');
        if (box) { box.textContent = msg; }
        this.placeElement.classList.remove('loading');
        this.placeElement.classList.add('error');
    };

    /** In the preview: the siteaccess selector reloads the iframe; the close link closes the preview. */
    Preview.prototype.setHandlers = function () {
        var self = this, jq = this.jq, preview = this.previewElement;
        if (!preview) { return; }
        var select = preview.querySelector('select'), closer = preview.querySelector('a.close');
        if (select) {
            listen(jq, select, 'change', null, function () {
                var sa = this.value, iframe = preview.querySelector('iframe'), loaders = nodes(jq, jq ? jq(preview).find('#iframe-loader') : preview.querySelectorAll('#iframe-loader'));
                var url = String((iframe && iframe.getAttribute('src')) || '').split('/');
                var ms = Exp.reducedMotion ? 0 : 200;
                loaders.forEach(function (l) { animate(jq, l, { opacity: 'show' }, ms); });
                url.pop();
                url.push(sa);
                if (!iframe) { return; }
                var loaded = function () { loaders.forEach(function (l) { animate(jq, l, { opacity: 'hide' }, ms); }); };
                if (jq) { jq(iframe).one('load', loaded); } else { iframe.addEventListener('load', loaded, { once: true }); }
                iframe.setAttribute('src', url.join('/'));
            });
        }
        if (closer) {
            listen(jq, closer, 'click', null, function (e) {
                e.preventDefault();
                self.close();
            });
        }
    };

    /**
     * Puts $.fn.expAutosave and $.fn.expPreview on a jQuery: Exp.$ when the file loads; call it for a jQuery the
     * page loads later.
     */
    function install(jq) {
        if (!jq || !jq.fn || (jq.fn.expAutosave && jq.fn.expAutosave.exp)) { return false; }
        jq.fn.expAutosave = function (conf) {
            return this.each(function () { jq(this).data('expAutosave', new AutoSubmit(jq.extend({}, conf, { form: this }), jq)); });
        };
        jq.fn.expPreview = function (conf) {
            return this.each(function () {
                var p = new Preview(jq.extend({}, conf, { buttonPlace: this }), jq);
                p.init();
                jq(this).data('expPreview', p);
            });
        };
        jq.fn.expAutosave.exp = jq.fn.expPreview.exp = true;
        return true;
    }

    Exp.autosave = { AutoSubmit: AutoSubmit, Preview: Preview, instances: instances, serializeForm: serializeForm, install: install };

    install(Exp.$);
}(window, document));
