/*!
 * Exponential UI (expui) upload — files uploaded with progress per file, cancel, several files and drop zones.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::upload after exp::core (and exp::io, for its error type). The admin relation uploader's upload
 * step and ezmultiupload's uploader:
 *
 *   Exp.upload.create(el, {                       or $(el).expUpload({ ... })
 *       url: '/admin/ezmultiupload/upload/327',   where each file is POSTed (one request per file)
 *       name: 'file',                             the file's field name (default: the input's name, else 'file')
 *       multiple: false, accept: 'image/*,.pdf',  what can be chosen (accept also takes ['*.jpg', ...])
 *       drop: false,                              true: el is a drop zone too; or a selector of the zone
 *       maxSize: 0,                               bytes, 0: no limit (larger files are refused, not sent)
 *       data: {} | function (file) {},            more POST fields per file; the form token is added
 *       form: null,                               a form whose fields are posted with each file, in order
 *       auto: true,                               upload as soon as files are chosen; false: call .start()
 *       parallel: 1, responseType: 'auto',        uploads at the same time; 'json', 'text' or 'auto'
 *       onDone(response, file), onFail(error, file), onProgress(file), onAdd(file), onComplete(summary)
 *   });
 *
 * el is a container (a chooser, a drop zone and the file list are built in it) or an <input type="file"> (used as
 * the chooser, the list goes after it). The instance: Exp.upload.get(el), $(el).data('expUpload') or
 * $(el).expUpload('instance'): add(files), start(), cancel(file|id) (no argument: all), files(), progress(), clear(),
 * enable(), disable(), destroy(). Events on el (bubbling) and page-wide (Exp.on), each with { upload, file, ... }:
 *   exp:upload:add, exp:upload:refuse { reason }, exp:upload:start, exp:upload:progress { loaded, total, percent },
 *   exp:upload:done { response }, exp:upload:fail { error }, exp:upload:cancel, exp:upload:complete { files, done,
 *   failed, canceled }.
 * Started from markup with data-exp-upload='{"url": "…", "multiple": true}'.
 *
 * Without jQuery it runs on plain JavaScript: the parts are elements (upload.el, .root, .zone, .input, .inputs,
 * .listElement, .dropZones; a file's .row, .bar, .statusElement, .cancelButton) and the events on el are
 * CustomEvents (event.detail). With jQuery 4 on the page it runs on it, exactly as before: its listeners (so
 * .trigger() reaches them), the events through .trigger() as well, the parts in jQuery too ($el, $root, $input,
 * $zone, $list, $drop; a file's $row, $bar, $status, $cancel) and $(el).data('expUpload'). The requests are the same
 * XMLHttpRequests either way.
 */
(function (window, document) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.config || !Exp.util) { return; }
    if (Exp.upload && Exp.upload.install) {
        // loaded twice: the first copy stays, with its uploads
        Exp.upload.install(Exp.$);
        return;
    }
    var util = Exp.util;

    var nextId = 0;
    var instances = new WeakMap();

    function t(text, params) { return Exp.i18n(text, params); }

    /** 1536 -> "1.5 kB"; in the page's language (the decimal separator). */
    function size(bytes) {
        var units = ['B', 'kB', 'MB', 'GB'], i = 0, n = Number(bytes) || 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        var decimals = i === 0 || n >= 10 ? 0 : 1, text = n.toFixed(decimals);
        try {
            text = new Intl.NumberFormat((Exp.config.locale && Exp.config.locale.http) || undefined,
                                         { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(Number(text));
        } catch (e) { /* the plain number */ }
        return text + ' ' + units[i];
    }

    /** The accept option as a list of tests: '.jpg', '*.jpg', 'image/*', 'image/png', '*.*' (anything). */
    function acceptList(accept) {
        if (!accept) { return []; }
        var list = Array.isArray(accept) ? accept : String(accept).split(/[,;]/);
        return list.map(function (a) { return String(a).trim().toLowerCase(); }).filter(Boolean);
    }
    function acceptAttr(list) {
        if (!list.length || list.indexOf('*.*') !== -1 || list.indexOf('*') !== -1) { return ''; }
        return list.map(function (a) { return a.indexOf('*.') === 0 ? a.slice(1) : a; }).join(',');
    }
    function accepted(file, list) {
        if (!list.length) { return true; }
        var name = String(file.name || '').toLowerCase(), type = String(file.type || '').toLowerCase();
        return list.some(function (a) {
            if (a === '*' || a === '*.*') { return true; }
            if (a.indexOf('*.') === 0) { a = a.slice(1); }
            if (a.charAt(0) === '.') { return name.length > a.length && name.slice(-a.length) === a; }
            if (/\/\*$/.test(a)) { return type.indexOf(a.slice(0, -1)) === 0; }
            return type === a;
        });
    }

    function ioError(kind, status, message, response) {
        if (Exp.io && Exp.io.Error) { return new Exp.io.Error(kind, status, message, response); }
        var e = new Error(message);
        e.kind = kind; e.status = status; e.response = response;
        return e;
    }

    function signedOut(xhr) {
        return xhr.status === 401 || /\/user\/login\b/.test(xhr.responseURL || '');
    }

    // ---- the DOM, with jQuery where the page has it ---------------------------------------------------------

    /** Elements: a selector, an element, a list or jQuery; through jQuery when there is one (its selectors). */
    function nodes(jq, target) {
        if (jq) { return jq(target).toArray(); }
        if (!target) { return []; }
        if (typeof target === 'string') { return Array.prototype.slice.call(document.querySelectorAll(target)); }
        return target.nodeType ? [target] : Array.prototype.slice.call(target);
    }
    function make(tag, attrs, text) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
        if (text !== undefined) { el.textContent = String(text); }
        return el;
    }
    /** A list of elements in jQuery, without passing the list through jQuery() itself (which may read it as text) */
    function wrap(jq, list) { return Array.isArray(list) ? jq.merge(jq(), list) : jq(list); }
    function remove(jq, el) { if (jq) { jq(el).remove(); } else if (el && el.parentNode) { el.parentNode.removeChild(el); } }

    /**
     * Binds a listener to each element, through jQuery when there is one (namespaced, so .trigger() reaches it and
     * .off('.expupload') removes it); returns the function that unbinds it.
     */
    function listen(jq, els, type, fn) {
        if (jq) { var $t = wrap(jq, els); $t.on(type, fn); return function () { $t.off(type, fn); }; }
        var name = type.split('.')[0];
        els.forEach(function (el) { el.addEventListener(name, fn); });
        return function () { els.forEach(function (el) { el.removeEventListener(name, fn); }); };
    }

    /**
     * An event on the element: through jQuery when the upload has it (handlers get (event, data)), and as a native
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

    function hasFiles(e) {
        var dt = (e.originalEvent || e).dataTransfer;
        return !!dt && Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1;
    }

    // ---- the upload -----------------------------------------------------------------------------------------

    /** el: the element (or jQuery: its first one); options: see the header; jq: the jQuery it runs on (default Exp.$). */
    function Upload(el, options, jq) {
        var self = this;
        if (el && el.jquery) { el = el[0]; }
        this.jq = jq = jq === undefined ? (Exp.$ || null) : jq;
        var o = this.options = util.extend({
            url: null, name: null, multiple: false, accept: null, drop: false, maxSize: 0, data: null, form: null,
            auto: true, parallel: 1, responseType: 'auto', headers: {}, token: true, list: true, input: null,
            texts: {}, onAdd: null, onRefuse: null, onStart: null, onProgress: null, onDone: null, onFail: null,
            onCancel: null, onComplete: null
        }, options || {});
        this.el = el;
        this.entries = [];
        this.enabled = true;
        this.accepts = acceptList(o.accept);
        this.texts = util.extend({
            select: o.multiple ? t('Select files') : t('Select a file'),
            drop: o.multiple ? t('or drop them here') : t('or drop it here'),
            cancel: t('Cancel'),
            cancelFile: t('Cancel the upload of %name'),
            waiting: t('Waiting'),
            uploading: t('Uploading'),
            done: t('Done'),
            failed: t('Failed'),
            canceled: t('Canceled'),
            tooLarge: t('The file is too large (%size, at most %max).'),
            wrongType: t('This type of file is not accepted.')
        }, o.texts || {});

        var isInput = el.matches('input[type="file"]');
        this.inputs = o.input ? nodes(jq, o.input) : (isInput ? [el] : []);
        this.zone = null;
        if (isInput) {
            this.root = make('div', { 'class': 'exp-upload exp-upload--input exp-scope' });
            el.parentNode.insertBefore(this.root, el.nextSibling);
        } else {
            this.root = el;
            el.classList.add('exp-upload', 'exp-scope');
            if (!this.inputs.length) {
                this.zone = el.appendChild(make('div', { 'class': 'exp-upload-zone' }));
                var label = this.zone.appendChild(make('label', { 'class': 'exp-upload-select' }));
                this.inputs = [label.appendChild(make('input', { type: 'file', 'class': 'exp-upload-input' }))];
                label.appendChild(make('span', { 'class': 'exp-upload-select-label' }, this.texts.select));
                if (o.drop) { this.zone.appendChild(make('span', { 'class': 'exp-upload-hint' }, this.texts.drop)); }
            }
        }
        this.input = this.inputs[0] || null;
        if (!o.name) { o.name = (this.input && this.input.getAttribute('name')) || 'file'; }
        if (o.multiple) { this.inputs.forEach(function (i) { i.multiple = true; }); }
        var acc = acceptAttr(this.accepts);
        if (acc) { this.inputs.forEach(function (i) { i.setAttribute('accept', acc); }); }
        this.listElement = make('ul', { 'class': 'exp-upload-list', 'aria-live': 'polite' });
        this.listElement.hidden = true;
        this.root.appendChild(this.listElement);
        if (!o.list) { this.listElement.classList.add('exp-visually-hidden'); }

        this.unbind = [];
        this.unbind.push(listen(jq, this.inputs, 'change.expupload', function () {
            if (!this.files || !this.files.length) { return; }
            self.add(this.files);
        }));

        var drops = this.dropZones = o.drop === true ? [isInput ? this.root : el] : (o.drop ? nodes(jq, o.drop) : []);
        if (drops.length) {
            var depth = 0;
            var over = function (on) { drops.forEach(function (d) { d.classList[on ? 'add' : 'remove']('is-over'); }); };
            drops.forEach(function (d) { d.classList.add('exp-upload-drop'); });
            this.unbind.push(listen(jq, drops, 'dragenter.expupload', function (e) {
                if (!self.enabled || !hasFiles(e)) { return; }
                e.preventDefault(); depth++; over(true);
            }));
            this.unbind.push(listen(jq, drops, 'dragover.expupload', function (e) {
                if (!self.enabled || !hasFiles(e)) { return; }
                e.preventDefault();
                (e.originalEvent || e).dataTransfer.dropEffect = 'copy';
            }));
            this.unbind.push(listen(jq, drops, 'dragleave.expupload', function () {
                depth = Math.max(0, depth - 1);
                if (!depth) { over(false); }
            }));
            this.unbind.push(listen(jq, drops, 'drop.expupload', function (e) {
                if (!hasFiles(e)) { return; }
                e.preventDefault(); depth = 0; over(false);
                if (!self.enabled) { return; }
                var files = (e.originalEvent || e).dataTransfer.files;
                self.add(o.multiple ? files : Array.prototype.slice.call(files, 0, 1));
            }));
        }
        instances.set(el, this);
        if (jq) { jq(el).data('expUpload', this); }
    }

    // the parts in jQuery, while the upload runs on it (undefined without jQuery), for code written for it
    var PARTS = { $el: 'el', $root: 'root', $input: 'inputs', $zone: 'zone', $list: 'listElement', $drop: 'dropZones' };
    Object.keys(PARTS).forEach(function (name) {
        Object.defineProperty(Upload.prototype, name, {
            configurable: true,
            get: function () { var v = this[PARTS[name]]; return this.jq && v ? wrap(this.jq, v) : undefined; },
            set: function (v) { Object.defineProperty(this, name, { value: v, writable: true, configurable: true, enumerable: true }); }
        });
    });

    Upload.prototype.emit = function (name, data, callback) {
        data = util.extend({ upload: this }, data);
        var o = this.options, cb = o[callback];
        if (typeof cb === 'function') {
            try {
                if (name === 'done') { cb.call(this, data.response, data.file); }
                else if (name === 'fail') { cb.call(this, data.error, data.file); }
                else if (name === 'complete') { cb.call(this, data); }
                else { cb.call(this, data.file, data); }
            } catch (e) {
                if (window.console) { window.console.error('Exp.upload: ' + callback + ' failed', e); }
            }
        }
        fire(this.el, 'exp:upload:' + name, data, this.jq);
        Exp.emit('exp:upload:' + name, data);
    };

    /** Adds files (a FileList, an array of File); refused ones (size, type) are listed with the reason. Starts them when auto. */
    Upload.prototype.add = function (files) {
        var self = this, o = this.options, added = [];
        var list = Array.prototype.slice.call(files || []);
        if (!o.multiple) {
            // one file at a time: a new choice replaces what has not been sent yet
            list = list.slice(0, 1);
            this.entries.filter(function (f) { return f.status === 'queued' || f.status === 'refused'; }).forEach(function (f) { self.drop(f); });
        }
        list.forEach(function (file) {
            nextId += 1;
            var entry = { id: 'exp-upload-' + nextId, file: file, name: file.name, size: file.size, type: file.type,
                          status: 'queued', loaded: 0, total: file.size, percent: 0, response: null, error: null, xhr: null };
            if (o.maxSize && file.size > o.maxSize) {
                entry.status = 'refused';
                entry.reason = self.texts.tooLarge.split('%size').join(size(file.size)).split('%max').join(size(o.maxSize));
            } else if (!accepted(file, self.accepts)) {
                entry.status = 'refused';
                entry.reason = self.texts.wrongType;
            }
            self.entries.push(entry);
            self.row(entry);
            if (entry.status === 'refused') {
                self.emit('refuse', { file: entry, reason: entry.reason }, 'onRefuse');
            } else {
                added.push(entry);
                self.emit('add', { file: entry }, 'onAdd');
            }
        });
        if (o.auto && added.length) { this.start(); }
        return added;
    };

    /** The file's row in the list: name, size, progress, status, cancel. */
    Upload.prototype.row = function (f) {
        var self = this, jq = this.jq;
        this.listElement.hidden = false;
        if (!f.row) {
            f.row = make('li', { 'class': 'exp-upload-file', id: f.id });
            f.row.appendChild(make('span', { 'class': 'exp-upload-name' }, f.name));
            f.row.appendChild(make('span', { 'class': 'exp-upload-size' }, size(f.size)));
            f.bar = f.row.appendChild(make('progress', { 'class': 'exp-upload-progress', max: '100', value: '0', 'aria-label': f.name }));
            f.statusElement = f.row.appendChild(make('span', { 'class': 'exp-upload-status' }));
            f.cancelButton = make('button', { type: 'button', 'class': 'exp-upload-cancel' }, this.texts.cancel);
            f.cancelButton.setAttribute('aria-label', this.texts.cancelFile.split('%name').join(f.name));
            listen(jq, [f.cancelButton], 'click', function (e) { e.preventDefault(); self.cancel(f); });
            f.row.appendChild(f.cancelButton);
            this.listElement.appendChild(f.row);
            if (jq) { f.$row = jq(f.row); f.$bar = jq(f.bar); f.$status = jq(f.statusElement); f.$cancel = jq(f.cancelButton); }
        }
        f.row.setAttribute('class', 'exp-upload-file is-' + f.status);
        f.bar.value = f.percent;
        f.bar.textContent = f.percent + '%';
        f.bar.hidden = f.status === 'refused';
        var text = { queued: this.texts.waiting, uploading: this.texts.uploading + ' ' + f.percent + '%', done: this.texts.done,
                     failed: this.texts.failed + (f.error && f.error.message ? ': ' + f.error.message : ''), canceled: this.texts.canceled,
                     refused: f.reason }[f.status];
        f.statusElement.textContent = text || '';
        f.cancelButton.hidden = f.status !== 'queued' && f.status !== 'uploading';
    };

    /** Removes a file that is not uploading from the list. */
    Upload.prototype.drop = function (f) {
        if (f.status === 'uploading') { return; }
        var i = this.entries.indexOf(f);
        if (i !== -1) { this.entries.splice(i, 1); }
        if (f.row) { remove(this.jq, f.row); }
        if (!this.entries.length) { this.listElement.hidden = true; }
    };

    /** The POST body of one file: the form's fields (the file put in its place), data, the form token. */
    Upload.prototype.body = function (f) {
        var o = this.options, fd;
        var form = o.form ? nodes(this.jq, o.form)[0] : null;
        if (o.form) {
            fd = new FormData(form);
            fd.set(o.name, f.file, f.name);
        } else {
            fd = new FormData();
        }
        var data = typeof o.data === 'function' ? o.data.call(this, f) : o.data;
        if (Array.isArray(data)) {
            data.forEach(function (d) { fd.append(d.name, d.value === undefined || d.value === null ? '' : d.value); });
        } else if (data) {
            Object.keys(data).forEach(function (k) { fd.append(k, data[k] === undefined || data[k] === null ? '' : data[k]); });
        }
        if (o.token && !fd.has('ezxform_token') && Exp.token && Exp.token()) { fd.append('ezxform_token', Exp.token()); }
        if (!o.form) { fd.append(o.name, f.file, f.name); }
        return fd;
    };

    /** Uploads the files waiting, o.parallel at a time; a Promise of the summary when all are finished. */
    Upload.prototype.start = function () {
        var self = this;
        if (!this.options.url) { throw new Error('Exp.upload: a url is needed'); }
        if (!this.running) {
            this.running = new Promise(function (resolve) { self.finished = resolve; });
        }
        var running = this.entries.filter(function (f) { return f.status === 'uploading'; }).length;
        var waiting = this.entries.filter(function (f) { return f.status === 'queued'; });
        while (running < Math.max(1, this.options.parallel) && waiting.length) {
            this.send(waiting.shift());
            running++;
        }
        this.check();
        return this.running;
    };

    Upload.prototype.check = function () {
        if (!this.running) { return; }
        var busy = this.entries.some(function (f) { return f.status === 'queued' || f.status === 'uploading'; });
        if (busy) { return; }
        var count = function (s) { return this.entries.filter(function (f) { return f.status === s && !f.reported; }).length; }.bind(this);
        var summary = { files: this.entries.filter(function (f) { return !f.reported && f.status !== 'refused'; }),
                        done: count('done'), failed: count('failed'), canceled: count('canceled') };
        summary.files.forEach(function (f) { f.reported = true; });
        var resolve = this.finished;
        this.running = null; this.finished = null;
        this.emit('complete', summary, 'onComplete');
        resolve(summary);
    };

    Upload.prototype.send = function (f) {
        var self = this, o = this.options;
        var xhr = f.xhr = new XMLHttpRequest();
        f.status = 'uploading';
        this.row(f);
        this.emit('start', { file: f }, 'onStart');
        xhr.open('POST', o.url, true);
        xhr.setRequestHeader('Accept', o.responseType === 'json' ? 'application/json, text/javascript, */*' : '*/*');
        Object.keys(o.headers || {}).forEach(function (h) { xhr.setRequestHeader(h, o.headers[h]); });
        xhr.upload.addEventListener('progress', function (e) {
            if (!e.lengthComputable || f.status !== 'uploading') { return; }
            f.loaded = e.loaded; f.total = e.total;
            f.percent = Math.min(99, Math.floor(100 * e.loaded / Math.max(1, e.total)));
            self.row(f);
            self.emit('progress', { file: f, loaded: e.loaded, total: e.total, percent: f.percent, overall: self.progress() }, 'onProgress');
        });
        xhr.addEventListener('load', function () {
            if (f.status !== 'uploading') { return; }
            if (signedOut(xhr)) { return self.fail(f, ioError('signedout', 401, t('You are no longer signed in. Sign in again and repeat this.'), xhr)); }
            if (xhr.status === 403) { return self.fail(f, ioError('refused', 403, t('The server answered with an error (HTTP %status).', { '%status': 403 }), xhr)); }
            if (xhr.status < 200 || xhr.status >= 300) { return self.fail(f, ioError('server', xhr.status, t('The server answered with an error (HTTP %status).', { '%status': xhr.status }), xhr)); }
            var text = xhr.responseText, response = text;
            var type = (xhr.getResponseHeader('Content-Type') || '').toLowerCase();
            if (o.responseType === 'json' || (o.responseType === 'auto' && (type.indexOf('json') !== -1 || /^\s*[\[{]/.test(text)))) {
                try { response = JSON.parse(text); } catch (e) {
                    if (o.responseType === 'json') { return self.fail(f, ioError('invalid', xhr.status, t('The server answered with an error (HTTP %status).', { '%status': xhr.status }), text)); }
                }
            }
            f.status = 'done'; f.percent = 100; f.loaded = f.total; f.response = response; f.xhr = null;
            self.row(f);
            self.emit('done', { file: f, response: response }, 'onDone');
            self.next();
        });
        xhr.addEventListener('error', function () {
            if (f.status === 'uploading') { self.fail(f, ioError('network', 0, t('No answer from the server.'), xhr)); }
        });
        xhr.addEventListener('timeout', function () {
            if (f.status === 'uploading') { self.fail(f, ioError('timeout', 0, t('No answer from the server.'), xhr)); }
        });
        xhr.send(this.body(f));
    };

    Upload.prototype.fail = function (f, error) {
        f.status = 'failed'; f.error = error; f.xhr = null;
        this.row(f);
        this.emit('fail', { file: f, error: error }, 'onFail');
        this.next();
    };

    Upload.prototype.next = function () {
        if (this.entries.some(function (f) { return f.status === 'queued'; })) { this.start(); } else { this.check(); }
    };

    function find(self, f) {
        if (f && typeof f === 'object' && self.entries.indexOf(f) !== -1) { return f; }
        return self.entries.filter(function (e) { return e.id === f || (f && f.id === e.id); })[0] || null;
    }

    /** Cancels one file (an entry or its id) or, with no argument, every file waiting or uploading. */
    Upload.prototype.cancel = function (which) {
        var self = this;
        var list = which === undefined ? this.entries.slice() : [find(this, which)];
        list.forEach(function (f) {
            if (!f || (f.status !== 'queued' && f.status !== 'uploading')) { return; }
            var xhr = f.xhr;
            f.status = 'canceled'; f.xhr = null;
            if (xhr) { try { xhr.abort(); } catch (e) { /* gone already */ } }
            self.row(f);
            self.emit('cancel', { file: f }, 'onCancel');
        });
        this.next();
        return this;
    };

    /** The files, in the order they were added. */
    Upload.prototype.files = function () { return this.entries.slice(); };

    /** Bytes sent of the files uploading or done in this round: { loaded, total, percent, count, done }. */
    Upload.prototype.progress = function () {
        var round = this.entries.filter(function (f) { return !f.reported && (f.status === 'uploading' || f.status === 'done' || f.status === 'queued'); });
        var loaded = 0, total = 0;
        round.forEach(function (f) { total += f.total || 0; loaded += f.status === 'done' ? (f.total || 0) : (f.loaded || 0); });
        return { loaded: loaded, total: total, percent: total ? Math.min(100, Math.floor(100 * loaded / total)) : 0, count: round.length,
                 done: round.filter(function (f) { return f.status === 'done'; }).length };
    };

    /** Empties the list of the files that are finished (done, failed, canceled, refused). */
    Upload.prototype.clear = function () {
        var self = this;
        this.entries.slice().forEach(function (f) { if (f.status !== 'uploading' && f.status !== 'queued') { self.drop(f); } });
        return this;
    };

    Upload.prototype.enable = function () {
        this.enabled = true;
        this.inputs.forEach(function (i) { i.disabled = false; });
        this.root.classList.remove('is-disabled');
        return this;
    };
    Upload.prototype.disable = function () {
        this.enabled = false;
        this.inputs.forEach(function (i) { i.disabled = true; });
        this.root.classList.add('is-disabled');
        return this;
    };

    /** Cancels what is running and takes the list, the chooser it built and its handlers away. */
    Upload.prototype.destroy = function () {
        var jq = this.jq;
        this.cancel();
        if (jq) {
            wrap(jq, this.inputs).off('.expupload');
            wrap(jq, this.dropZones).off('.expupload');
        } else {
            this.unbind.forEach(function (off) { off(); });
        }
        this.unbind = [];
        this.dropZones.forEach(function (d) { d.classList.remove('exp-upload-drop', 'is-over'); });
        remove(jq, this.listElement);
        if (this.zone) { remove(jq, this.zone); }
        if (this.root !== this.el) { remove(jq, this.root); } else { this.root.classList.remove('exp-upload', 'exp-scope', 'is-disabled'); }
        instances.delete(this.el);
        if (jq) { jq(this.el).removeData('expUpload'); }
    };

    /** The instance on an element (an element, a selector or jQuery), or null. */
    function get(el) {
        el = nodes(null, el)[0];
        return (el && instances.get(el)) || null;
    }

    /** Exp.upload.create(el, options): sets one up on el (an element, a selector or jQuery: the first); an element that has one keeps it. */
    function create(el, options) {
        el = nodes(null, el)[0];
        if (!el) { return null; }
        return get(el) || new Upload(el, options);
    }

    /**
     * Puts $.fn.expUpload on a jQuery: Exp.$ when the file loads; call it for a jQuery the page loads later.
     * $(el).expUpload(options) sets it up; $(el).expUpload('start' | 'cancel' | 'clear' | 'destroy' | 'instance').
     */
    function install(jq) {
        if (!jq || !jq.fn || (jq.fn.expUpload && jq.fn.expUpload.exp)) { return false; }
        jq.fn.expUpload = function (options) {
            if (typeof options === 'string') {
                var inst = this[0] ? instances.get(this[0]) || null : null;
                if (options === 'instance') { return inst; }
                this.each(function () { var u = instances.get(this); if (u && typeof u[options] === 'function') { u[options](); } });
                return this;
            }
            return this.each(function () {
                if (instances.get(this)) { return; }
                new Upload(this, options, jq);
            });
        };
        jq.fn.expUpload.exp = true;
        return true;
    }

    Exp.upload = {
        Upload: Upload, size: size, accepted: function (file, accept) { return accepted(file, acceptList(accept)); },
        create: create, get: get, install: install
    };

    install(Exp.$);

    Exp.register('upload', function (target, options) {
        if (target && target.jquery) { target.expUpload(options); return; }
        create(target, options);
    });
}(window, document));
