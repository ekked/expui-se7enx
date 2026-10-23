/*!
 * Exponential UI (expui) dialog — modal dialogs on the native <dialog> element.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::dialog after exp::core (Exp.dialog.form also needs exp::io). The admin dialogs:
 * simple dialogs and the modal window:
 *
 *   Exp.dialog.open({ title, content | url | template, buttons: [{ label, value, primary, danger }], size: 'm',
 *                     onClose })                                    -> Promise<value>   (dismissed: null)
 *   Exp.dialog.confirm(text, { okLabel, cancelLabel, danger })      -> Promise<boolean>
 *   Exp.dialog.alert(text)                                          -> Promise<undefined>
 *   Exp.dialog.form(url, { title })                                 -> Promise<the server's answer>  (dismissed: null)
 *   Exp.dialog.create(options)                                      -> a Dialog, opened with .open()
 *
 * The page behind is inert while a dialog is open (showModal), Tab and Shift+Tab stay inside it, Escape and the
 * close button dismiss it (unless dismissible: false), a click on the backdrop only with closeOnBackdrop: true, and
 * the focus goes back to where it was. aria-labelledby names the title (or the text, without a title).
 * Events, on the dialog element (bubbling) and page-wide (Exp.on): exp:dialog:open { dialog },
 * exp:dialog:close { dialog, value }. Started from markup with data-exp-dialog (see doc/modules/dialog.md).
 *
 * Without jQuery it runs on plain JavaScript: the parts are elements (dialog.element, .header, .heading,
 * .closeButton, .body, .errorElement, .footer), the events on the element are CustomEvents (event.detail), a
 * button's action gets the browser's event, url loads through fetch (Exp.util.request()). With jQuery 4 on the page
 * it runs on it, exactly as before: its listeners, $.ajax(), .html() for scripts: true, the events through
 * .trigger() as well, the parts in jQuery too ($el, $header, $title, $close, $body, $error, $footer) and
 * $(dialog.element).data('expDialog'). Exp.dialog.get(element) finds a dialog either way.
 */
(function (window, document) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.config || !Exp.util) { return; }
    if (Exp.dialog && Exp.dialog.Dialog) {
        // loaded twice: the first copy stays, with its open dialogs
        return;
    }
    var util = Exp.util;

    var SIZES = ['s', 'm', 'l', 'xl'];
    var FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
                    'textarea:not([disabled]), iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), ' +
                    'summary, [tabindex]:not([tabindex="-1"])';
    var counter = 0;
    var openDialogs = [];
    var dialogs = new WeakMap();

    function t(text, params) { return Exp.i18n(text, params); }

    function visible(el) {
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && window.getComputedStyle(el).visibility !== 'hidden';
    }

    /** The elements Tab reaches inside root, in order. */
    function focusables(root) {
        return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
            return el.tabIndex >= 0 && visible(el) && !el.closest('[inert]');
        });
    }

    // ---- the DOM, with jQuery where the page has it ---------------------------------------------------------

    function make(tag, attrs) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
        return el;
    }
    /** The first element of a selector (inside context, when given), an element, a list or jQuery, or null. */
    function first(jq, target, context) {
        if (jq) { return (context ? jq(target, context) : jq(target))[0] || null; }
        if (!target) { return null; }
        if (typeof target === 'string') { return (context || document).querySelector(target); }
        return target.nodeType ? target : target[0] || null;
    }
    function remove(jq, el) { if (jq) { jq(el).remove(); } else if (el.parentNode) { el.parentNode.removeChild(el); } }
    function empty(jq, el) { if (jq) { jq(el).empty(); } else { while (el.firstChild) { el.removeChild(el.firstChild); } } }
    /** jQuery's .append(): a node, a fragment, HTML, or a list of them (jQuery, NodeList, array) */
    function append(el, content) {
        if (content === null || content === undefined) { return; }
        if (typeof content === 'string') { el.insertAdjacentHTML('beforeend', content); return; }
        if (content.nodeType) { el.appendChild(content); return; }
        Array.prototype.slice.call(content).forEach(function (c) { append(el, c); });
    }
    /** HTML with its <script> elements run (as jQuery's .html()); new script elements, so the browser runs them */
    function htmlWithScripts(el, html) {
        el.innerHTML = html;
        Array.prototype.forEach.call(el.querySelectorAll('script'), function (old) {
            var s = document.createElement('script');
            Array.prototype.forEach.call(old.attributes, function (a) { s.setAttribute(a.name, a.value); });
            s.text = old.text;
            old.parentNode.replaceChild(s, old);
        });
    }

    /**
     * A listener: through jQuery when there is one (so .trigger() reaches it), else as jQuery would bind it: a
     * selector delegates (no clicks of other buttons or on disabled elements), this is the matched element.
     */
    function listen(jq, el, type, selector, fn) {
        if (jq) { jq(el).on(type, selector || null, fn); return; }
        el.addEventListener(type.split('.')[0], selector ? function (e) {
            if (e.type === 'click' && e.button >= 1) { return; }
            for (var cur = e.target; cur && cur !== el; cur = cur.parentNode) {
                if (cur.nodeType === 1 && !(e.type === 'click' && cur.disabled === true) && cur.matches(selector)) { fn.call(cur, e); return; }
            }
        } : fn);
    }

    /**
     * An event on the element: through jQuery when the dialog has it (handlers get (event, data)), and as a native
     * CustomEvent (event.detail is the data). While the CustomEvent is dispatched, the jQuery that triggered is told
     * it is triggered already (jQuery.event.triggered), so its handlers run once; any other jQuery gets the native
     * event like any listener.
     */
    function fire(el, name, data, jq) {
        if (jq) { jq(el).trigger(name, [data]); }
        var guarded = jq && jq.event ? [jq] : [];
        var was = guarded.map(function (j) { var w = j.event.triggered; j.event.triggered = name; return w; });
        try {
            el.dispatchEvent(new window.CustomEvent(name, { bubbles: true, detail: data }));
        } finally {
            guarded.forEach(function (j, i) { j.event.triggered = was[i]; });
        }
    }

    // ---- the dialog -----------------------------------------------------------------------------------------

    /**
     * A dialog. Created closed; open() shows it as a modal and returns a Promise of the value it is closed with.
     * Options: see the header and doc/modules/dialog.md. jq: the jQuery it runs on (default Exp.$; null: none).
     */
    function Dialog(options, jq) {
        var self = this;
        this.jq = jq = jq === undefined ? (Exp.$ || null) : jq;
        counter += 1;
        this.id = 'exp-dialog-' + counter;
        this.options = (jq ? jq.extend : util.extend)({
            title: '', content: null, url: null, template: null, buttons: [], size: 'm', width: null,
            className: '', dismissible: true, closeOnBackdrop: false, closeSelector: null, initialFocus: null,
            role: 'dialog', describedBy: null, keep: false, scripts: false, onOpen: null, onClose: null
        }, options || {});
        this.isOpen = false;
        this.value = null;
        this.returnFocus = null;
        this.promise = null;
        this.resolver = null;

        var o = this.options;
        var el = this.element = make('dialog', { 'class': 'exp-dialog exp-scope', id: this.id, 'aria-labelledby': this.id + '-title' });
        el.classList.add(SIZES.indexOf(o.size) !== -1 ? 'exp-dialog--' + o.size : 'exp-dialog--m');
        if (o.role === 'alertdialog') { el.setAttribute('role', 'alertdialog'); }
        if (o.className) { String(o.className).split(/\s+/).filter(Boolean).forEach(function (c) { el.classList.add(c); }); }
        if (o.width) { el.style.width = typeof o.width === 'number' ? 'min(' + o.width + 'px, calc(100vw - 2rem))' : o.width; }

        var frame = el.appendChild(make('div', { 'class': 'exp-dialog-frame' }));
        this.header = frame.appendChild(make('header', { 'class': 'exp-dialog-header' }));
        this.heading = this.header.appendChild(make('h2', { 'class': 'exp-dialog-title', id: this.id + '-title' }));
        this.closeButton = make('button', { type: 'button', 'class': 'exp-dialog-close' });
        this.closeButton.innerHTML = '<span aria-hidden="true">&times;</span>';
        this.closeButton.setAttribute('aria-label', t('Close'));
        this.closeButton.setAttribute('title', t('Close'));
        this.header.appendChild(this.closeButton);
        if (!o.dismissible) { this.closeButton.hidden = true; }
        this.body = frame.appendChild(make('div', { 'class': 'exp-dialog-body', id: this.id + '-body' }));
        this.errorElement = make('div', { 'class': 'exp-dialog-error', role: 'alert', hidden: '' });
        frame.insertBefore(this.errorElement, this.body);
        this.footer = frame.appendChild(make('footer', { 'class': 'exp-dialog-footer', hidden: '' }));

        this.setTitle(o.title);
        if (o.describedBy) { el.setAttribute('aria-describedby', o.describedBy); }
        this.setButtons(o.buttons);

        // native Escape: dismiss (the dialog closes itself only through close(), so the Promise is always settled)
        listen(jq, el, 'cancel', null, function (e) {
            e.preventDefault();
            if (self.options.dismissible) { self.close(null); }
        });
        // closed by anything else (form method=dialog, the browser): settle as dismissed
        listen(jq, el, 'close', null, function () {
            if (self.isOpen) { self.finish(self.element.returnValue && self.element.returnValue !== '' ? self.element.returnValue : null); }
        });
        // Tab and Shift+Tab stay inside
        listen(jq, el, 'keydown', null, function (e) {
            if (e.key !== 'Tab') { return; }
            var list = focusables(self.element);
            if (!list.length) { e.preventDefault(); self.element.focus(); return; }
            var firstOne = list[0], last = list[list.length - 1], active = document.activeElement;
            if (e.shiftKey && (active === firstOne || !self.element.contains(active))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (active === last || !self.element.contains(active))) { e.preventDefault(); firstOne.focus(); }
        });
        // the close button, [data-exp-dialog-close] and closeSelector inside; the backdrop (a click on <dialog> itself)
        listen(jq, el, 'click', null, function (e) {
            if (e.target === self.element) {
                if (self.options.closeOnBackdrop && self.options.dismissible) { self.close(null); }
                return;
            }
            var selector = '.exp-dialog-close, [data-exp-dialog-close]' + (self.options.closeSelector ? ', ' + self.options.closeSelector : '');
            var closer = jq ? jq(e.target).closest(selector, self.element)[0] : closestWithin(e.target, selector, self.element);
            if (closer && closer.closest('dialog') === self.element) {
                e.preventDefault();
                var v = closer.getAttribute('data-exp-dialog-close');
                self.close(v === null || v === '' ? null : v);
            }
        });

        // in the page from the start (a closed <dialog> is not shown), so content that runs scripts (scripts: true) runs them
        document.body.appendChild(el);
        if (o.content !== null && o.content !== undefined) { this.setContent(o.content); }
        else if (o.template) {
            // a <template> (its content cloned) or any element (its children cloned)
            var tpl = first(jq, o.template);
            if (tpl) {
                this.setContent(tpl.content ? document.importNode(tpl.content, true)
                                            : (jq ? jq(tpl).clone().contents() : Array.prototype.slice.call(tpl.cloneNode(true).childNodes)));
            }
        }
        dialogs.set(el, this);
        if (jq) { jq(el).data('expDialog', this); }
    }

    /** .closest(selector) from node, not beyond root (as jQuery's .closest(selector, root)) */
    function closestWithin(node, selector, root) {
        for (var cur = node && node.nodeType === 1 ? node : node && node.parentElement; cur && cur !== root; cur = cur.parentElement) {
            if (cur.matches(selector)) { return cur; }
        }
        return null;
    }

    // the parts in jQuery, while the dialog runs on it (undefined without jQuery), for code written for it
    var PARTS = { $el: 'element', $header: 'header', $title: 'heading', $close: 'closeButton', $body: 'body', $error: 'errorElement', $footer: 'footer' };
    Object.keys(PARTS).forEach(function (name) {
        Object.defineProperty(Dialog.prototype, name, {
            configurable: true,
            get: function () { var v = this[PARTS[name]]; return this.jq && v ? this.jq(v) : undefined; },
            set: function (v) { Object.defineProperty(this, name, { value: v, writable: true, configurable: true, enumerable: true }); }
        });
    });

    /** The title, as text. Without a title the header keeps only the close button, and the body names the dialog. */
    Dialog.prototype.setTitle = function (title) {
        this.heading.textContent = title === null || title === undefined ? '' : String(title);
        var has = this.heading.textContent !== '';
        this.heading.hidden = !has;
        this.element.setAttribute('aria-labelledby', has ? this.id + '-title' : (this.options.labelledBy || this.id + '-body'));
        return this;
    };

    /** The content: an HTML string (from the server or a template), an element, jQuery, a fragment, or a function returning one. */
    Dialog.prototype.setContent = function (content) {
        var jq = this.jq;
        if (typeof content === 'function') { content = content.call(this, this); }
        empty(jq, this.body);
        if (content === null || content === undefined || content === '') { return this; }
        if (typeof content === 'string') {
            // HTML is inserted, its <script> elements are not run (no eval; options.scripts: true runs them, as jQuery's html())
            if (!this.options.scripts) { this.body.innerHTML = content; }
            else if (jq) { jq(this.body).html(content); }
            else { htmlWithScripts(this.body, content); }
        } else if (jq) { jq(this.body).append(content); } else { append(this.body, content); }
        Exp.start(this.body);
        return this;
    };

    /** The footer buttons: [{ label, value, primary, danger, close (default true), action(dialog, event) -> false keeps it open }]. */
    Dialog.prototype.setButtons = function (buttons) {
        var self = this, jq = this.jq;
        empty(jq, this.footer);
        (buttons || []).forEach(function (b) {
            var button = make('button', { type: 'button', 'class': 'exp-dialog-button' });
            button.textContent = b.label === undefined ? String(b.value) : b.label;
            if (b.primary) { button.classList.add('is-primary'); }
            if (b.danger) { button.classList.add('is-danger'); }
            if (b.name) { button.setAttribute('name', b.name); }
            listen(jq, button, 'click', null, function (e) {
                e.preventDefault();
                var keep = typeof b.action === 'function' ? b.action.call(self, self, e) === false : false;
                if (!keep && b.close !== false) { self.close(b.value === undefined ? null : b.value); }
            });
            if (jq) { jq(button).data('expDialogButton', b); }
            self.footer.appendChild(button);
        });
        this.footer.hidden = !this.footer.children.length;
        return this;
    };

    /** Shows a translated error above the body (role alert); empty or no text hides it. */
    Dialog.prototype.error = function (text) {
        this.errorElement.textContent = text || '';
        this.errorElement.hidden = !text;
        return this;
    };

    /** While busy: aria-busy, the body dimmed and not clickable, "Loading..." for screen readers. */
    Dialog.prototype.busy = function (on) {
        var jq = this.jq, el = this.element;
        el.classList.toggle('exp-dialog--busy', !!on);
        el.setAttribute('aria-busy', on ? 'true' : 'false');
        if (on && !el.querySelector('.exp-dialog-spinner')) {
            var spinner = make('div', { 'class': 'exp-dialog-spinner', role: 'status' });
            var label = spinner.appendChild(make('span', { 'class': 'exp-visually-hidden' }));
            label.textContent = t('Loading...');
            this.body.parentNode.insertBefore(spinner, this.body);
        } else if (!on) {
            Array.prototype.forEach.call(el.querySelectorAll('.exp-dialog-spinner'), function (s) { remove(jq, s); });
        }
        return this;
    };

    /** Loads HTML into the body (GET, or opts.method/opts.data), busy meanwhile; a Promise of the HTML. */
    Dialog.prototype.load = function (url, opts) {
        var self = this, jq = this.jq;
        opts = opts || {};
        this.busy(true).error('');
        var request = { url: url, method: (opts.method || 'GET').toUpperCase(), data: opts.data, dataType: 'html', headers: { Accept: 'text/html,*/*' } };
        return new Promise(function (resolve, reject) {
            (jq ? jq.ajax(request) : util.request(request))
                .then(function (html) {
                    self.busy(false).setContent(html);
                    resolve(html);
                }, function (xhr) {
                    var status = xhr ? xhr.status : 0;
                    self.busy(false).error(status ? t('The server answered with an error (HTTP %status).', { '%status': status }) : t('No answer from the server.'));
                    var message = self.errorElement.textContent;
                    reject(Exp.io && Exp.io.Error ? new Exp.io.Error(status ? 'server' : 'network', status, message, xhr) : new Error(message));
                });
        });
    };

    /** Where the focus goes on open: initialFocus, [autofocus], the first field of the body, the primary button, close. */
    Dialog.prototype.focusTarget = function () {
        var o = this.options, el = this.element, jq = this.jq;
        var pick = o.initialFocus ? first(jq, o.initialFocus, el) || first(jq, o.initialFocus) : null;
        if (pick && el.contains(pick)) { return pick; }
        var auto = el.querySelector('[autofocus]');
        if (auto) { return auto; }
        var inBody = focusables(this.body);
        if (inBody.length) { return inBody[0]; }
        var primary = this.footer.querySelector('.is-primary') || this.footer.querySelector('button');
        if (primary) { return primary; }
        return visible(this.closeButton) ? this.closeButton : el;
    };

    /** Shows it as a modal; a Promise of the value it is closed with (null when dismissed). */
    Dialog.prototype.open = function () {
        var self = this, o = this.options;
        if (this.isOpen) { return this.promise; }
        this.promise = new Promise(function (resolve) { self.resolver = resolve; });
        this.returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
        if (!this.element.isConnected) { document.body.appendChild(this.element); }
        if (!this.element.hasAttribute('tabindex')) { this.element.setAttribute('tabindex', '-1'); }
        this.isOpen = true;
        this.value = null;
        this.element.returnValue = '';
        if (typeof this.element.showModal === 'function') { this.element.showModal(); } else { this.element.setAttribute('open', 'open'); }
        openDialogs.push(this);
        var loading = o.url ? this.load(o.url, { method: o.method, data: o.data }) : null;
        var focus = function () { if (self.isOpen) { var f = self.focusTarget(); if (f && f.focus) { f.focus(); } } };
        focus();
        if (loading) { loading.then(focus, focus); }
        if (typeof o.onOpen === 'function') { o.onOpen.call(this, this); }
        fire(this.element, 'exp:dialog:open', { dialog: this }, this.jq);
        Exp.emit('exp:dialog:open', { dialog: this });
        return this.promise;
    };

    /** Closes it with a value (null: dismissed): onClose, the event, the focus back, the Promise resolved. */
    Dialog.prototype.close = function (value) {
        if (!this.isOpen) { return this; }
        this.isOpen = false;
        if (this.element.open && typeof this.element.close === 'function') { this.element.close(); } else { this.element.removeAttribute('open'); }
        this.finish(value === undefined ? null : value, true);
        return this;
    };

    Dialog.prototype.finish = function (value, already) {
        if (!already) { this.isOpen = false; }
        if (this.settled === this.promise) { return; }
        this.settled = this.promise;
        this.value = value;
        var i = openDialogs.indexOf(this);
        if (i !== -1) { openDialogs.splice(i, 1); }
        if (typeof this.options.onClose === 'function') {
            try { this.options.onClose.call(this, value, this); } catch (e) { if (window.console) { window.console.error('Exp.dialog: onClose failed', e); } }
        }
        fire(this.element, 'exp:dialog:close', { dialog: this, value: value }, this.jq);
        Exp.emit('exp:dialog:close', { dialog: this, value: value });
        var back = this.returnFocus;
        if (back && document.contains(back) && typeof back.focus === 'function') { back.focus(); }
        if (!this.options.keep) { remove(this.jq, this.element); }
        if (this.resolver) { this.resolver(value); }
    };

    /** Closes it and removes it from the page. */
    Dialog.prototype.destroy = function () {
        this.close(null);
        remove(this.jq, this.element);
    };

    // ---- the shortcuts ----------------------------------------------------------------------------------------

    function open(options) {
        var d = new Dialog(options);
        var p = d.open();
        p.dialog = d;
        return p;
    }

    /** A paragraph with the text (as text), the dialog's description and, without a title, its name. */
    function textBody(id, text) {
        var p = make('p', { 'class': 'exp-dialog-text', id: id });
        p.textContent = String(text === undefined || text === null ? '' : text);
        return p;
    }

    function confirm(text, opts) {
        opts = opts || {};
        counter += 1;
        var textId = 'exp-dialog-text-' + counter;
        var cancel = { label: opts.cancelLabel || t('Cancel'), value: false, name: 'cancel' };
        var ok = { label: opts.okLabel || t('OK'), value: true, primary: true, danger: !!opts.danger, name: 'ok' };
        var d = new Dialog({
            title: opts.title || '', content: textBody(textId, text), buttons: [cancel, ok], size: opts.size || 's',
            role: 'alertdialog', describedBy: textId, labelledBy: textId, className: 'exp-dialog--confirm' + (opts.danger ? ' exp-dialog--danger' : ''),
            initialFocus: opts.danger ? 'button[name="cancel"]' : 'button[name="ok"]', onClose: opts.onClose
        });
        var p = d.open().then(function (v) { return v === true; });
        p.dialog = d;
        return p;
    }

    function alert(text, opts) {
        opts = opts || {};
        counter += 1;
        var textId = 'exp-dialog-text-' + counter;
        var d = new Dialog({
            title: opts.title || '', content: textBody(textId, text), buttons: [{ label: opts.okLabel || t('OK'), value: true, primary: true, name: 'ok' }],
            size: opts.size || 's', role: 'alertdialog', describedBy: textId, labelledBy: textId, className: 'exp-dialog--alert',
            initialFocus: 'button[name="ok"]', onClose: opts.onClose
        });
        var p = d.open().then(function () { return undefined; });
        p.dialog = d;
        return p;
    }

    /**
     * Loads a form (url, or opts.content) into a dialog and posts it with Exp.io.form when it is submitted; resolves
     * with the server's answer and closes. opts.onResponse(answer, dialog) returning false keeps it open (to show
     * the server's next form, say). Errors are shown in the dialog, which stays open. Dismissed: null.
     */
    function form(url, opts) {
        opts = opts || {};
        var d = new Dialog(util.extend({}, opts, { url: url || null, content: opts.content === undefined ? null : opts.content,
                                                   className: 'exp-dialog--form' + (opts.className ? ' ' + opts.className : '') }));
        listen(d.jq, d.body, 'submit', 'form', function (e) {
            e.preventDefault();
            if (!Exp.io || !Exp.io.form) {
                d.error(t('The server answered with an error (HTTP %status).', { '%status': 0 }));
                if (window.console) { window.console.error('Exp.dialog.form needs exp::io'); }
                return;
            }
            var f = this, native = e.originalEvent || e, submitter = native.submitter || null;
            d.busy(true).error('');
            Exp.io.form(f, { submitter: submitter, url: opts.action }).then(function (answer) {
                d.busy(false);
                if (typeof opts.onResponse === 'function' && opts.onResponse.call(d, answer, d) === false) { return; }
                d.close(answer);
            }, function (err) {
                d.busy(false).error(err && err.message ? err.message : t('No answer from the server.'));
            });
        });
        var p = d.open();
        p.dialog = d;
        return p;
    }

    /** The dialog on top, or null. */
    function current() { return openDialogs.length ? openDialogs[openDialogs.length - 1] : null; }

    function closeAll() { openDialogs.slice().reverse().forEach(function (d) { d.close(null); }); }

    /** The dialog of a <dialog> element (or a selector), or null. */
    function get(el) {
        el = first(null, el);
        return (el && dialogs.get(el)) || null;
    }

    Exp.dialog = {
        open: open, confirm: confirm, alert: alert, form: form,
        create: function (options) { return new Dialog(options); },
        current: current, closeAll: closeAll, get: get, Dialog: Dialog
    };

    // ---- from markup ------------------------------------------------------------------------------------------

    var confirmed = new WeakSet();

    /**
     * data-exp-dialog on a link or button:
     *   '{"confirm": "Remove it?", "danger": true}'  asks first; OK follows the link or submits the button's form
     *   '{"title": "…", "form": true}'                opens the link's address as a form dialog
     *   '{"title": "…", "template": "#tpl"}'          opens the template's content
     *   (anything else)                                opens the link's address (or "url") in a dialog
     */
    Exp.register('dialog', function (target, options) {
        var el = target && target.jquery ? target[0] : target;
        listen(Exp.$ || null, el, 'click.expdialog', null, function (e) {
            if (confirmed.has(el)) { confirmed.delete(el); return; }
            e.preventDefault();
            var href = options.url || el.getAttribute('href') || null;
            if (options.confirm) {
                confirm(options.confirm, options).then(function (ok) {
                    if (!ok) { return; }
                    if (el.form && (el.type === 'submit' || el.type === 'image')) {
                        if (typeof el.form.requestSubmit === 'function') {
                            el.form.requestSubmit(el);          // submits with this button, without a click
                        } else {
                            confirmed.add(el);                  // the click below goes through once
                            el.click();
                        }
                    } else if (href) {
                        window.location.href = href;
                    }
                });
            } else if (options.form) {
                form(href, options);
            } else {
                open(util.extend({}, options, { url: options.template ? null : href }));
            }
        });
    });
}(window, document));
