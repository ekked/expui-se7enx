/*!
 * Exponential UI (expui) datatable — sortable, paged tables with selection, column toggling, inline editing and
 * action menus, on plain JavaScript (and jQuery 4 when the page has it).
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::datatable after exp::core (and exp::io for server functions). The admin tables' data table stack
 * (DataTable, Paginator, TextboxCellEditor, DataSource / XHRDataSource, Button, SimpleDialog, Cookie):
 *
 *   var table = Exp.datatable.create(el, {
 *       columns:  [{ key: 'name', label: 'Name', sortable: true, render: function (row, td) {}, editable: 'number' }],
 *       source:   { url: function (state) {}, parse: function (json) { return { rows, total }; } }
 *                 | { fn: 'class::function', args: function (state) {}, parse } | { rows: [...] } | { dom: true }
 *                 | function (state) { return Promise.resolve({ rows, total }); },
 *       paging:   { limit: 25, containers: ['#bpg'], compact: ['#tpg'] },
 *       sort:     { key: 'priority', dir: 'asc' },
 *       select:   { key: 'checkbox', name: 'DeleteIDArray[]', value: function (row) {} },
 *       columnToggle: { shown: ['name'], save: function (keys) {} } | { pref: 'my_columns' },
 *       inlineEdit:   { canEdit: function (row) {}, save: function (row, key, value) {} } | { fn: 'class::function', data },
 *       actions:  [{ id: 'my-select', label: 'Select', menu: [...] }],
 *       tableOptions: { button: { id, label }, limits: { items: [{ id: 1, count: 10 }] }, columns: {} },
 *       filter:   { container: '#filter', delay: 400 },
 *       keyboard: true, empty: 'No records found.', loading: 'Loading...'
 *   });
 *   Exp.datatable.get(el)                 the instance: load(), reload(), setPage(), setLimit(), sortBy(), ...
 *   events on the element (CustomEvent, event.detail) and through Exp.on(): exp:datatable:load, :sort, :page,
 *   :filter, :select, :edit, :invalid, :columns, :options, :error
 *
 * Where jQuery is on the page, $(el).expDataTable(options) does the same as before, byte for byte: its callbacks get
 * jQuery objects ($td), $(el).data('expDataTable') is the instance, $(el).on('exp:datatable:load', fn(e, data)) hears
 * the events, and the instance has its jQuery properties ($table, $body, ...). The table's own listeners are then
 * bound with jQuery, so .trigger() reaches them as it did. The full reference is doc/modules/datatable.md.
 */
(function (window, document) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.config || !Exp.util) { return; }
    if (Exp.datatable && Exp.datatable.create) {
        // loaded twice (two packs asked for exp::datatable): the first copy stays, with its tables
        Exp.datatable.install(Exp.$);
        return;
    }
    var extend = Exp.util.extend;

    var nextId = 0;
    function uid(prefix) { nextId += 1; return (prefix || 'exp-dt') + '-' + nextId; }
    function t(text, params) { return Exp.i18n(text, params); }
    function isFn(f) { return typeof f === 'function'; }
    function trim(value) { return String(value).replace(/^\s+|\s+$/g, ''); }
    function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function pad(n, w) { n = String(n); while (n.length < (w || 2)) { n = '0' + n; } return n; }

    /** A Date (or a timestamp in ms) as strftime-like text: %d %m %Y %y %H %M %S %e %%. */
    function formatDate(value, format) {
        var d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) { return ''; }
        return String(format || '%Y-%m-%d %H:%M').replace(/%([dmYyHMSe%])/g, function (all, c) {
            switch (c) {
            case 'd': return pad(d.getDate());
            case 'e': return (d.getDate() < 10 ? ' ' : '') + d.getDate();
            case 'm': return pad(d.getMonth() + 1);
            case 'Y': return String(d.getFullYear());
            case 'y': return pad(d.getFullYear() % 100);
            case 'H': return pad(d.getHours());
            case 'M': return pad(d.getMinutes());
            case 'S': return pad(d.getSeconds());
            default: return '%';
            }
        });
    }

    /** The value as a number, or undefined when it is not one. */
    function validateNumber(value) {
        var n = value * 1;
        return typeof n === 'number' && isFinite(n) ? n : undefined;
    }

    /** The offset rule: a page boundary, and never past the last page. */
    function normalizeOffset(offset, total, limit) {
        if (offset <= 0 || total === 0) { return 0; }
        if (total === null || total > offset) { return offset - (offset % limit); }
        return total - (total % limit || limit);
    }

    /** The page numbers shown around the current one (the classic paginator's range). */
    function pageRange(current, pages, links) {
        if (!current || links === 0 || pages === 0) { return [0, -1]; }
        links = Math.min(links, pages);
        var start = Math.max(1, Math.ceil(current - (links / 2)));
        var end = Math.min(pages, start + links - 1);
        start = Math.max(1, start - (links - (end - start + 1)));
        return [start, end];
    }

    function compareValues(a, b) {
        var na = typeof a === 'number' ? a : (a !== null && a !== '' && !isNaN(a) ? Number(a) : NaN);
        var nb = typeof b === 'number' ? b : (b !== null && b !== '' && !isNaN(b) ? Number(b) : NaN);
        if (!isNaN(na) && !isNaN(nb)) { return na - nb; }
        if (a instanceof Date && b instanceof Date) { return a - b; }
        return String(a === null || a === undefined ? '' : a).localeCompare(String(b === null || b === undefined ? '' : b));
    }

    function editableType(column) {
        var e = column.editable;
        if (!e) { return null; }
        if (e === true) { return { type: 'text' }; }
        if (typeof e === 'string') { return { type: e }; }
        return extend({ type: 'text' }, e);
    }

    // ---- the DOM, the way the jQuery version wrote it --------------------------------------------------------
    // Each helper does what the jQuery call it stands for did (attr(), addClass(), text(), html(), append() ...), so
    // the markup is the same attribute for attribute.

    // Table parts are parsed inside the elements they belong in, as jQuery does (its wrapMap)
    var WRAP = { thead: ['table'], tbody: ['table'], tfoot: ['table'], colgroup: ['table'], caption: ['table'],
                 col: ['colgroup', 'table'], tr: ['tbody', 'table'], td: ['tr', 'tbody', 'table'], th: ['tr', 'tbody', 'table'] };

    /** The nodes an HTML string stands for. */
    function parseHtml(html) {
        var tag = (/<([a-z][^\/\0>\x20\t\r\n\f]*)/i.exec(html) || ['', ''])[1].toLowerCase();
        var wrap = WRAP[tag] || [], host = document.createElement('div');
        for (var j = wrap.length - 1; j >= 0; j--) { host = host.appendChild(document.createElement(wrap[j])); }
        host.innerHTML = html;
        return Array.prototype.slice.call(host.childNodes).map(function (n) { host.removeChild(n); return n; });
    }

    /** One element from its HTML: make('<span class="x"></span>'). */
    function make(html) {
        return parseHtml(html).filter(function (n) { return n.nodeType === 1; })[0];
    }

    /** .attr(name, value): undefined changes nothing, null (and false, but for aria-*) removes it. */
    function attr(el, name, value) {
        if (value === undefined) { return; }
        if (value === null || (value === false && name.toLowerCase().indexOf('aria-') !== 0)) { el.removeAttribute(name); return; }
        el.setAttribute(name, String(value));
    }
    function attrs(el, map) { for (var name in map) { attr(el, name, map[name]); } }
    function classes(value) { return String(value === null || value === undefined ? '' : value).split(/\s+/).filter(Boolean); }
    function addClass(el, value) { classes(value).forEach(function (c) { el.classList.add(c); }); }
    function removeClass(el, value) { classes(value).forEach(function (c) { el.classList.remove(c); }); }
    function toggleClass(el, value, on) { if (on) { addClass(el, value); } else { removeClass(el, value); } }
    /** .text(value): undefined changes nothing */
    function setText(el, value) { if (value !== undefined) { el.textContent = value === null ? '' : value; } }
    /** .html(value): undefined changes nothing */
    function setHtml(el, value) {
        if (value === undefined) { return; }
        if (typeof value === 'string') { el.innerHTML = value; } else { empty(el); append(el, value); }
    }
    function empty(el) { el.textContent = ''; return el; }
    function remove(el) { if (el && el.parentNode) { el.parentNode.removeChild(el); } }
    function before(el, target) { if (target.parentNode) { target.parentNode.insertBefore(el, target); } }

    /** .append(content...): elements, lists of them (a jQuery object too), HTML, or text. */
    function append(parent) {
        for (var i = 1; i < arguments.length; i++) {
            var x = arguments[i];
            if (x === null || x === undefined || x === false) { continue; }
            if (x.nodeType) { parent.appendChild(x); }
            else if (typeof x === 'string') {
                if (/<|&#?\w+;/.test(x)) {
                    parseHtml(x).forEach(function (n) { parent.appendChild(n); });
                } else {
                    parent.appendChild(document.createTextNode(x));
                }
            } else if (typeof x === 'object' && typeof x.length === 'number') {
                Array.prototype.slice.call(x).forEach(function (n) { append(parent, n); });
            } else {
                parent.appendChild(document.createTextNode(String(x)));
            }
        }
        return parent;
    }

    function inDocumentOrder(list) {
        return list.slice().sort(function (a, b) {
            if (a === b) { return 0; }
            return a.compareDocumentPosition(b) & 4 ? -1 : 1;
        });
    }

    /** $(target).toArray(): a selector, an element, a list of elements (a jQuery object too). */
    function nodes(target) {
        if (target === null || target === undefined || target === '') { return []; }
        if (typeof target === 'string') {
            if (/^#[\w-]+$/.test(target)) { var one = document.getElementById(target.slice(1)); return one ? [one] : []; }
            return Array.prototype.slice.call(document.querySelectorAll(target));
        }
        if (target.nodeType || target === window) { return [target]; }
        return typeof target.length === 'number' ? Array.prototype.slice.call(target) : [];
    }
    function first(target) { return nodes(target)[0] || null; }
    /** Elements (one, or a list) in jQuery, without passing a list through jQuery() itself */
    function wrapIn(jq, x) { return Array.isArray(x) ? jq.merge(jq(), x) : jq(x); }
    function find(el, selector) { return el ? Array.prototype.slice.call(el.querySelectorAll(selector)) : []; }
    /** .closest() from any node, a text node too */
    function closest(node, selector) {
        var el = node && node.nodeType !== 1 ? node.parentElement : node;
        return el && el.closest ? el.closest(selector) : null;
    }
    function matches(node, selector) { return !!(node && node.nodeType === 1 && node.matches(selector)); }
    /** jQuery's :visible */
    function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

    /**
     * Binds a listener: with jQuery through it (namespaces included, and .trigger() reaches it), without it as jQuery
     * would: selector delegates (deepest match first, no clicks of other buttons or on disabled elements), this is
     * the element, false prevents the default and stops the event. Returns the function that unbinds it.
     */
    function listen(jq, target, types, selector, fn) {
        if (jq) {
            var $t = wrapIn(jq, nodes(target));
            $t.on(types, selector || null, fn);
            return function () { $t.off(types, selector || null, fn); };
        }
        var bound = [];
        var call = function (el, e) {
            if (fn.call(el, e) === false) { e.preventDefault(); e.stopPropagation(); }
        };
        String(types).split(/\s+/).forEach(function (full) {
            var type = full.split('.')[0];
            if (!type) { return; }
            nodes(target).forEach(function (root) {
                var handler = selector ? function (e) {
                    if (e.type === 'click' && e.button >= 1) { return; }
                    for (var cur = e.target; cur && cur !== root; cur = cur.parentNode) {
                        if (cur.nodeType === 1 && !(e.type === 'click' && cur.disabled === true) && cur.matches(selector)) {
                            call(cur, e);
                            if (e.cancelBubble) { break; }
                        }
                    }
                } : function (e) { call(root, e); };
                root.addEventListener(type, handler);
                bound.push([root, type, handler]);
            });
        });
        return function () { bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); }); };
    }

    /**
     * An event on the element: through jQuery when the table has it (handlers get (event, data)), and as a native
     * CustomEvent (event.detail is the data) for addEventListener(). jQuery's own handlers sit on the same native
     * events: while the CustomEvent is dispatched they are told it is triggered already (jQuery.event.triggered,
     * the guard jQuery uses for its own native calls), so they run once, from the jQuery trigger, with the data.
     * Only the jQuery that triggered is guarded: another jQuery on the page, or any jQuery when the table has none,
     * gets the native event like any other listener.
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

    // ---- what belongs to which element ------------------------------------------------------------------------

    var tables = new WeakMap(), rowsOf = new WeakMap(), itemsOf = new WeakMap();

    function store(inst, el) {
        tables.set(el, inst);
        if (inst.jq) { inst.jq.data(el, 'expDataTable', inst); }
    }
    function unstore(inst, el) {
        tables.delete(el);
        if (inst.jq) { inst.jq.removeData(el, 'expDataTable'); }
    }
    /** The instance set up on el (or on the table inside it), or null. */
    function get(el) {
        el = first(el);
        if (!el) { return null; }
        return tables.get(el) || (Exp.$ && Exp.$.data(el, 'expDataTable')) || null;
    }

    // ---- the menu buttons of the toolbar --------------------------------------------------------------------

    /**
     * One button with a menu (or a plain button): the admin's button markup ids, an ARIA menu, arrow keys, Home, End,
     * type-ahead, Escape and Tab close it.
     */
    function MenuButton(table, def) {
        var self = this, jq = table.jq;
        this.table = table;
        this.def = def;
        this.id = def.id || uid('exp-dt-action');
        this.wrap = make('<span class="exp-dt-action"></span>');
        attr(this.wrap, 'id', this.id);
        if (def.className) { addClass(this.wrap, def.className); }
        this.button = make('<button type="button" class="exp-dt-button"></button>');
        attr(this.button, 'id', this.id + '-button');
        if (def.html) { setHtml(this.button, def.label); } else { setText(this.button, def.label || ''); }
        if (def.title) { attr(this.button, 'title', def.title); }
        this.wrap.appendChild(this.button);
        this.group = make('<span class="exp-dt-action-group"></span>');
        this.group.appendChild(this.wrap);
        this.hasMenu = !!def.menu;
        if (this.hasMenu) {
            addClass(this.wrap, 'exp-dt-menu-button');
            this.menu = make('<ul class="exp-dt-menu" role="menu" hidden="hidden"></ul>');
            attrs(this.menu, { id: this.id + '-menu', 'aria-labelledby': this.id + '-button' });
            attrs(this.button, { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': this.id + '-menu' });
            this.group.appendChild(this.menu);
            listen(jq, this.menu, 'click', '[role=menuitem]', function (e) { e.preventDefault(); self.choose(this); });
            listen(jq, this.menu, 'keydown', null, function (e) { self.menuKey(e); });
            listen(jq, this.button, 'keydown', null, function (e) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    self.open(e.key === 'ArrowUp' ? 'last' : 'first');
                } else if (e.key === 'Escape' && self.isOpen()) {
                    // opened with the mouse, the focus stays on the button
                    e.preventDefault(); e.stopPropagation();
                    self.close(true);
                }
            });
        }
        listen(jq, this.button, 'click', null, function (e) {
            e.preventDefault();
            if (self.disabled()) { return; }
            if (self.hasMenu) { if (self.isOpen()) { self.close(); } else { self.open(e.detail === 0 ? 'first' : null); } }
            else { table.closeMenus(self); if (isFn(def.onClick)) { def.onClick.call(table, table, table.userEvent(e)); } }
        });
        this.setDisabled(!!def.disabled);
    }
    MenuButton.prototype.disabled = function () { return this.button.disabled; };
    MenuButton.prototype.setDisabled = function (on) {
        this.button.disabled = !!on;
        toggleClass(this.wrap, 'exp-dt-action-disabled', !!on);
        if (on) { this.close(); }
    };
    MenuButton.prototype.isOpen = function () { return this.hasMenu && !this.menu.hidden; };
    MenuButton.prototype.items = function () {
        var m = this.def.menu;
        return (isFn(m) ? m.call(this.table, this.table) : m) || [];
    };
    MenuButton.prototype.render = function () {
        var menu = empty(this.menu), self = this;
        var appendItem = function (list, item) {
            var li = make('<li role="none" class="exp-dt-menuitem"></li>');
            if (item.id) { attr(li, 'id', item.id); }
            var b = make('<button type="button" role="menuitem" tabindex="-1"></button>');
            if (item.html) { setHtml(b, item.label); } else { setText(b, item.label === undefined ? '' : item.label); }
            if (item.disabled) { attr(b, 'aria-disabled', 'true'); addClass(li, 'exp-dt-menuitem-disabled'); }
            itemsOf.set(b, item);
            list.appendChild(append(li, b));
        };
        this.items().forEach(function (entry) {
            if (entry && entry.items) {
                var gid = uid(self.id + '-group');
                var g = make('<li role="none" class="exp-dt-menu-groupwrap"></li>');
                var list = make('<ul role="group"></ul>');
                attr(list, 'aria-labelledby', gid);
                var title = make('<span class="exp-dt-menu-group"></span>');
                attr(title, 'id', gid);
                setText(title, entry.group || '');
                append(g, title, list);
                entry.items.forEach(function (item) { appendItem(list, item); });
                menu.appendChild(g);
            } else if (entry) {
                appendItem(menu, entry);
            }
        });
    };
    MenuButton.prototype.menuItems = function () { return find(this.menu, '[role=menuitem]'); };
    /** The listener on the page that closes the menu on a click outside it. */
    MenuButton.prototype.unlistenPage = function () {
        if (this.offPage) { this.offPage(); this.offPage = null; }
        if (this.table.jq) { this.table.jq(document).off('mousedown.expdtmenu' + this.id); }
    };
    MenuButton.prototype.open = function (focus) {
        if (!this.hasMenu || this.disabled()) { return; }
        this.table.closeMenus(this);
        this.render();
        this.menu.hidden = false;
        attr(this.button, 'aria-expanded', 'true');
        addClass(this.wrap, 'exp-dt-menu-open');
        var items = this.menuItems();
        if (items.length) {
            var target = focus === 'last' ? items[items.length - 1] : items[0];
            items.forEach(function (i) { i.setAttribute('tabindex', '-1'); });
            target.setAttribute('tabindex', '0');
            if (focus) { target.focus(); }
        }
        var self = this;
        this.unlistenPage();
        this.offPage = listen(this.table.jq, document, 'mousedown.expdtmenu' + this.id, null, function (e) {
            if (!self.group.contains(e.target)) { self.close(); }
        });
        if (isFn(this.def.onOpen)) { this.def.onOpen.call(this.table, this.table); }
    };
    MenuButton.prototype.close = function (focusButton) {
        if (!this.hasMenu || this.menu.hidden) { return; }
        this.menu.hidden = true;
        attr(this.button, 'aria-expanded', 'false');
        removeClass(this.wrap, 'exp-dt-menu-open');
        this.unlistenPage();
        if (focusButton) { this.button.focus(); }
    };
    /** b: the menu item's button (with jQuery: the button or the button in jQuery) */
    MenuButton.prototype.choose = function (b) {
        var item = itemsOf.get(b && b.jquery ? b[0] : b);
        if (!item || item.disabled) { return; }
        this.close(true);
        var handler = isFn(item.onSelect) ? item.onSelect : this.def.onSelect;
        if (isFn(handler)) { handler.call(this.table, item, this.table); }
    };
    MenuButton.prototype.menuKey = function (e) {
        var items = this.menuItems(), i = items.indexOf(document.activeElement), next = null, n = items.length;
        switch (e.key) {
        case 'ArrowDown': next = items[(i + 1) % n]; break;
        case 'ArrowUp': next = items[(i - 1 + n) % n]; break;
        case 'Home': next = items[0]; break;
        case 'End': next = items[n - 1]; break;
        case 'Escape': e.preventDefault(); e.stopPropagation(); this.close(true); return;
        case 'Tab': this.close(); return;
        case 'Enter':
        case ' ':
            if (i !== -1) { e.preventDefault(); this.choose(items[i]); }
            return;
        default:
            if (e.key && e.key.length === 1 && /\S/.test(e.key)) {
                var key = e.key.toLowerCase();
                for (var k = 1; k <= n; k++) {
                    var cand = items[(i + k) % n];
                    if (cand.textContent.replace(/^\s+/, '').charAt(0).toLowerCase() === key) { next = cand; break; }
                }
            }
        }
        if (next) {
            e.preventDefault();
            items.forEach(function (x) { x.setAttribute('tabindex', '-1'); });
            next.setAttribute('tabindex', '0');
            next.focus();
        }
    };

    // ---- the table -------------------------------------------------------------------------------------------

    var DEFAULTS = {
        columns: null,
        source: null,
        rowKey: null,
        paging: {},
        sort: null,
        select: null,
        columnToggle: null,
        inlineEdit: null,
        actions: null,
        actionsContainer: null,
        tableOptions: null,
        filter: null,
        keyboard: true,
        empty: null,
        loading: null,
        error: null,
        caption: '',
        tableClass: '',
        dateFormat: '%Y-%m-%d %H:%M',
        onLoad: null,
        onRender: null
    };

    /**
     * new DataTable(el, options): el, the element to build the table in, or a <table> to enhance. A jQuery object
     * instead of el sets the table up as $(el).expDataTable(options) does (callbacks get jQuery objects).
     * how (internal): { jq: the jQuery to bind the listeners with (Exp.$ by default, null: none), wrapped: callbacks
     * get jQuery objects }.
     */
    function DataTable(el, options, how) {
        how = how || {};
        if (el && el.jquery) {
            how = { jq: how.jq || el.constructor, wrapped: true };
            el = el[0];
        }
        this.jq = how.jq !== undefined ? how.jq || null : (Exp.$ || null);
        this.wrapped = !!(how.wrapped && this.jq);
        this.el = el;
        this.o = extend({}, DEFAULTS, options || {});
        this.id = this.el.id || uid();
        this.cache = {};
        this.cacheOrder = [];
        this.seq = 0;
        this.rowsData = [];
        this.total = 0;
        this.menus = [];
        this.pagers = [];
        this.compacts = [];
        this.lastChecked = null;
        this.editing = null;
        this.init();
    }

    /** An element for a callback: in jQuery when the table was set up through $.fn.expDataTable, else the element. */
    DataTable.prototype.wrap = function (el) { return this.wrapped ? wrapIn(this.jq, el) : el; };
    /** An event for a callback: jQuery's event through $.fn.expDataTable, else the browser's. */
    DataTable.prototype.userEvent = function (e) { return this.wrapped ? e : (e && e.originalEvent) || e; };
    /** The row (the source's object) a <tr> of the table shows, or undefined. */
    DataTable.prototype.rowData = function (tr) { return tr ? rowsOf.get(tr.jquery ? tr[0] : tr) : undefined; };
    DataTable.prototype.listen = function (target, types, selector, fn) { return listen(this.jq, target, types, selector, fn); };

    DataTable.prototype.init = function () {
        var o = this.o, self = this;
        var p = this.paging = extend({ limit: 25, offset: 0, pageLinks: 10, containers: null, compact: null, alwaysVisible: true,
                                       labels: {} }, o.paging === false ? { off: true } : o.paging || {});
        p.labels = extend({ first: '&laquo;', prev: '&lsaquo;', next: '&rsaquo;', last: '&raquo;' }, p.labels);
        this.texts = {
            empty: o.empty !== null ? o.empty : t('No records found.'),
            loading: o.loading !== null ? o.loading : t('Loading...'),
            error: o.error !== null ? o.error : t('Data error.')
        };

        // the table: the element itself when it is one (its header and rows give the columns and data), else built
        if (this.el.tagName === 'TABLE') {
            this.table = this.el;
            this.root = make('<div class="exp-dt"></div>');
            before(this.root, this.table);
            this.root.appendChild(this.table);
            if (!o.columns) { o.columns = this.columnsFromMarkup(); }
            if (!o.source) { o.source = { dom: true }; }
        } else {
            this.root = this.el;
            addClass(this.root, 'exp-dt');
            empty(this.root);
            this.table = make('<table></table>');
            this.root.appendChild(this.table);
        }
        addClass(this.table, 'exp-dt-table');
        addClass(this.table, o.tableClass || '');
        // a table wider than its column scrolls inside it instead of running over the next column
        this.scroller = make('<div class="exp-dt-scroll"></div>');
        before(this.scroller, this.table);
        this.scroller.appendChild(this.table);
        this.columns = (o.columns || []).map(function (c) { return extend({ sortable: false, hidden: false }, c); });

        // the selection column
        var sel = this.select = o.select ? extend({ key: 'select', name: '', className: 'exp-dt-check', value: null,
                                                    label: null, header: true, ranges: true }, o.select === 'checkbox' || o.select === true ? {} : o.select) : null;
        if (sel && !this.column(sel.key)) { this.columns.unshift({ key: sel.key, label: '', sortable: false }); }
        // the order the columns were defined in: Table options lists them so, whatever order they are shown in
        this.defOrder = this.columns.slice();

        // shown columns from columnToggle: only the ones with a label can be hidden; ordered: true also puts the
        // shown ones in the order of the list
        var ct = o.columnToggle;
        if (ct) {
            var shown = ct.shown;
            if (!shown && ct.pref) {
                var v = Exp.prefs.get(ct.pref, null);
                shown = v ? String(v).split(',') : null;
            }
            if (shown && shown.length) {
                this.columns.forEach(function (c) { if (c.label && shown.indexOf(c.key) === -1) { c.hidden = true; } });
                if (ct.ordered) { this.applyOrder(shown); }
            }
            this.shownKeys = shown || null;
        }

        this.state = { offset: 0, limit: p.off ? null : Number(p.limit) || 25, sort: o.sort ? { key: o.sort.key, dir: o.sort.dir === 'desc' ? 'desc' : 'asc' } : null, filter: '' };
        if (p.offset) { this.state.offset = Number(p.offset) || 0; }

        this.buildHead();
        this.message = make('<tbody class="exp-dt-message" hidden="hidden"><tr><td></td></tr></tbody>');
        this.table.appendChild(this.message);
        this.body = make('<tbody class="exp-dt-body"></tbody>');
        this.table.appendChild(this.body);
        if (this.domRows) { append(this.body, this.domRows.map(function (r) { return r._tr; })); }
        if (o.caption) {
            var caption = make('<caption class="exp-visually-hidden"></caption>');
            setText(caption, o.caption);
            this.table.insertBefore(caption, this.table.firstChild);
        }
        this.status = make('<div class="exp-visually-hidden" role="status" aria-live="polite"></div>');
        this.root.appendChild(this.status);

        this.buildPagers();
        this.buildActions();
        this.buildFilter();
        this.bind();
        store(this, this.el);
        if (this.table !== this.el) { store(this, this.table); }
        if (o.initialLoad !== false) { this.load(); }
    };

    DataTable.prototype.columnsFromMarkup = function () {
        var cols = [];
        find(this.table, 'thead th').forEach(function (th, i) {
            var key = th.getAttribute('data-key') || ('c' + i);
            cols.push({ key: key, label: trim(th.textContent), html: th.innerHTML,
                        sortable: th.hasAttribute('data-sortable') || th.classList.contains('exp-dt-sortable') });
        });
        var keys = cols.map(function (c) { return c.key; });
        this.domRows = find(this.table, 'tbody tr').map(function (tr) {
            var row = { _tr: tr };
            Array.prototype.filter.call(tr.children, function (c) { return matches(c, 'td, th'); }).forEach(function (cell, i) {
                row[keys[i]] = cell.hasAttribute('data-value') ? cell.getAttribute('data-value') : trim(cell.textContent);
            });
            return row;
        });
        find(this.table, 'thead, tbody').forEach(remove);
        return cols;
    };

    DataTable.prototype.column = function (key) {
        for (var i = 0; i < this.columns.length; i++) { if (this.columns[i].key === key) { return this.columns[i]; } }
        return null;
    };

    /**
     * Puts the columns in the order of keys: the ones without a label (selection, row menu) stay first, then the
     * keys in their order, then the rest in their defined order.
     */
    DataTable.prototype.applyOrder = function (keys) {
        var fixed = [], listed = [], rest = [];
        this.defOrder.forEach(function (c) {
            if (!c.label) { fixed.push(c); } else if (keys.indexOf(c.key) === -1) { rest.push(c); }
        });
        keys.forEach(function (k) {
            for (var i = 0; i < this.defOrder.length; i++) {
                var c = this.defOrder[i];
                if (c.key === k && c.label && listed.indexOf(c) === -1) { listed.push(c); break; }
            }
        }, this);
        this.columns = fixed.concat(listed, rest);
    };

    /** A column's alignment class: align: 'right' or 'center'. */
    function alignClass(c) { return c.align === 'right' || c.align === 'center' ? ' exp-dt-align-' + c.align : ''; }

    DataTable.prototype.buildHead = function () {
        var self = this, tr = make('<tr></tr>');
        this.columns.forEach(function (c) {
            var th = make('<th scope="col"></th>');
            attr(th, 'data-key', c.key);
            addClass(th, 'exp-dt-col-' + c.key + alignClass(c));
            if (c.className) { addClass(th, c.className); }
            if (c.headerClassName) { addClass(th, c.headerClassName); }
            if (c.title) { attr(th, 'title', c.title); }
            if (self.select && c.key === self.select.key) {
                addClass(th, 'exp-dt-col-select');
                if (self.select.header) {
                    self.checkAll = make('<input type="checkbox" class="exp-dt-check-all" />');
                    attr(self.checkAll, 'aria-label', t('Select all'));
                    th.appendChild(self.checkAll);
                }
            } else if (c.sortable) {
                addClass(th, 'exp-dt-sortable');
                attr(th, 'aria-sort', 'none');
                var b = make('<button type="button" class="exp-dt-sort"></button>');
                if (c.html && !c.label) { setHtml(b, c.html); } else { setText(b, c.label || ''); }
                th.appendChild(b);
            } else if (c.label) {
                var label = make('<span class="exp-dt-label"></span>');
                toggleClass(label, 'exp-visually-hidden', !!c.labelHidden);
                setText(label, c.label);
                th.appendChild(label);
            }
            if (c.hidden) { th.hidden = true; }
            tr.appendChild(th);
        });
        var head = make('<thead></thead>');
        head.appendChild(tr);
        if (this.head) { if (this.head.parentNode) { this.head.parentNode.replaceChild(head, this.head); } } else { this.table.appendChild(head); }
        this.head = head;
        this.updateSortHeads();
    };

    DataTable.prototype.updateSortHeads = function () {
        var s = this.state.sort;
        find(this.head, 'th.exp-dt-sortable').forEach(function (th) {
            var key = th.getAttribute('data-key'), on = s && s.key === key;
            var dir = on ? s.dir : null;
            th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');
            toggleClass(th, 'exp-dt-asc', dir === 'asc');
            toggleClass(th, 'exp-dt-desc', dir === 'desc');
            // what a click does next: the opposite direction when sorted by it, else ascending
            find(th, 'button.exp-dt-sort').forEach(function (b) {
                attr(b, 'title', dir === 'asc' ? t('Click to sort descending') : t('Click to sort ascending'));
            });
        });
    };

    // ---- pagers -------------------------------------------------------------------------------------------

    DataTable.prototype.buildPagers = function () {
        var p = this.paging, self = this;
        this.pagers = [];
        this.compacts = [];
        if (p.off) { return; }
        var flat = function (list) { return [].concat.apply([], [].concat(list || []).map(nodes)); };
        var full = p.containers ? flat(p.containers) : null;
        if (!full) {
            var wrap = make('<div class="exp-dt-pager-wrap"></div>');
            this.root.appendChild(wrap);
            full = [wrap];
        }
        full.forEach(function (c) {
            var nav = make('<nav class="exp-dt-pager"></nav>');
            attr(nav, 'aria-label', t('Pages'));
            empty(c).appendChild(nav);
            self.pagers.push(nav);
        });
        flat(p.compact).forEach(function (c) {
            var nav = make('<nav class="exp-dt-pager exp-dt-pager-compact"></nav>');
            attr(nav, 'aria-label', t('Pages'));
            empty(c).appendChild(nav);
            self.compacts.push(nav);
        });
        this.pagers = inDocumentOrder(this.pagers);
        this.compacts = inDocumentOrder(this.compacts);
        this.listen(this.pagers.concat(this.compacts), 'click', 'button', function (e) {
            e.preventDefault();
            var b = this, page = self.page(), pages = self.pages();
            if (b.disabled) { return; }
            if (b.classList.contains('exp-dt-first')) { self.setPage(1); }
            else if (b.classList.contains('exp-dt-prev')) { self.setPage(page - 1); }
            else if (b.classList.contains('exp-dt-next')) { self.setPage(page + 1); }
            else if (b.classList.contains('exp-dt-last')) { self.setPage(pages); }
            else if (b.classList.contains('exp-dt-page')) { self.setPage(Number(b.getAttribute('data-page'))); }
        });
    };

    DataTable.prototype.page = function () {
        return this.state.limit ? Math.ceil(this.state.offset / this.state.limit) + 1 : 1;
    };
    DataTable.prototype.pages = function () {
        return this.state.limit ? Math.ceil(this.total / this.state.limit) : (this.total ? 1 : 0);
    };

    DataTable.prototype.renderPagers = function () {
        if (this.paging.off) { return; }
        var p = this.paging, page = this.total ? this.page() : 0, pages = this.pages(), L = p.labels;
        var btn = function (cls, html, label, disabled) {
            var b = make('<button type="button"></button>');
            addClass(b, cls);
            setHtml(b, html);
            attr(b, 'aria-label', label);
            b.disabled = !!disabled;
            return b;
        };
        var isFirst = page <= 1, isLast = page >= pages;
        this.pagers.forEach(function (nav) {
            empty(nav);
            var list = make('<span class="exp-dt-pages"></span>');
            var r = pageRange(page, pages, p.pageLinks);
            for (var i = r[0]; i <= r[1]; i++) {
                var item;
                if (i === page) {
                    item = make('<span class="exp-dt-page exp-dt-current" aria-current="page"></span>');
                    attr(item, 'data-page', i);
                } else {
                    item = make('<button type="button" class="exp-dt-page"></button>');
                    attrs(item, { 'data-page': i, 'aria-label': t('Page %page', { '%page': i }) });
                }
                setText(item, i);
                list.appendChild(item);
            }
            append(nav, append(make('<span class="exp-dt-backward"></span>'), btn('exp-dt-first', L.first, t('First page'), isFirst), btn('exp-dt-prev', L.prev, t('Previous page'), isFirst)),
                   list,
                   append(make('<span class="exp-dt-forward"></span>'), btn('exp-dt-next', L.next, t('Next page'), isLast), btn('exp-dt-last', L.last, t('Last page'), isLast)));
        });
        this.compacts.forEach(function (nav) {
            append(empty(nav), btn('exp-dt-prev', L.prev, t('Previous page'), isFirst), btn('exp-dt-next', L.next, t('Next page'), isLast));
        });
        // alwaysVisible: false hides the pagers while everything fits on one page, as the classic paginator did
        this.pagers.concat(this.compacts).forEach(function (nav) { nav.hidden = !p.alwaysVisible && pages <= 1; });
    };

    // ---- toolbar, Table options, filter ------------------------------------------------------------------

    /** The toolbar element (actionsContainer, or one made at the top of the table); null when actionsContainer is not on the page. */
    DataTable.prototype.toolbarNode = function () {
        if (this.toolbarElement === undefined) {
            var bar = this.o.actionsContainer ? first(this.o.actionsContainer) : null;
            if (!this.o.actionsContainer) {
                bar = make('<div class="exp-dt-toolbar"></div>');
                this.root.insertBefore(bar, this.root.firstChild);
            }
            if (bar) {
                addClass(bar, 'exp-dt-actions');
                attr(bar, 'role', bar.getAttribute('role') || 'toolbar');
                if (!bar.getAttribute('aria-label')) { attr(bar, 'aria-label', t('Table actions')); }
            }
            this.toolbarElement = bar;
        }
        return this.toolbarElement;
    };
    /** The toolbar: the element (in jQuery through $.fn.expDataTable). */
    DataTable.prototype.toolbar = function () { return this.wrap(this.toolbarNode()); };

    DataTable.prototype.buildActions = function () {
        var self = this, defs = (this.o.actions || []).slice();
        var to = this.o.tableOptions;
        if (to) {
            defs.push(extend({ id: 'exp-dt-options', label: t('Table options') }, to.button || {}, { menu: null, onClick: function () { self.openOptions(); } }));
        }
        if (!defs.length) { return; }
        var bar = this.toolbarNode();
        defs.forEach(function (d) {
            var m = new MenuButton(self, d);
            self.menus.push(m);
            if (bar) { append(bar, m.group, ' '); }
        });
    };

    DataTable.prototype.action = function (id) {
        for (var i = 0; i < this.menus.length; i++) { if (this.menus[i].id === id) { return this.menus[i]; } }
        return null;
    };

    DataTable.prototype.closeMenus = function (except) {
        this.menus.forEach(function (m) { if (m !== except) { m.close(); } });
    };

    DataTable.prototype.buildFilter = function () {
        var f = this.o.filter, self = this;
        if (!f) { return; }
        f = this.filterConf = extend({ input: null, container: null, delay: 400, attrs: {} }, f === true ? {} : f);
        var input = f.input ? first(f.input) : null;
        if (!input) {
            input = make('<input type="text" />');
            attrs(input, extend({ 'aria-label': t('Filter') }, f.attrs));
            var host = f.container ? first(f.container) : this.toolbarNode();
            if (host) { host.appendChild(input); }
        } else if (!input.getAttribute('aria-label') && !input.getAttribute('id')) {
            attr(input, 'aria-label', t('Filter'));
        }
        this.filterInput = input;
        var timer = null;
        this.offFilter = this.listen(input, 'input.expdt', null, function () {
            if (timer) { window.clearTimeout(timer); }
            timer = window.setTimeout(function () { timer = null; self.setFilter(input.value); }, f.delay);
        });
    };

    /** Table options: rows per page (and a custom number), and the visible columns. A native modal <dialog>. */
    DataTable.prototype.buildOptions = function () {
        var self = this, to = this.o.tableOptions, ids = uid('exp-dt-options');
        var d = make('<dialog class="exp-dt-dialog"></dialog>');
        attr(d, 'aria-labelledby', ids + '-title');
        var title = make('<h2 class="exp-dt-dialog-title"></h2>');
        attr(title, 'id', ids + '-title');
        setText(title, to.title || t('Table options'));
        d.appendChild(title);
        var bd = make('<div class="exp-dt-dialog-body"></div>');
        d.appendChild(bd);
        var lim = to.limits;
        if (lim) {
            var legend = make('<legend></legend>');
            setText(legend, lim.legend || t('Number of items per page:'));
            var fs = append(make('<fieldset></fieldset>'), legend);
            var block = make('<div class="block"></div>');
            fs.appendChild(block);
            (lim.items || []).forEach(function (item) {
                var r = make('<input type="radio" name="TableOptionValue" />');
                attrs(r, { id: 'table-option-row-btn-' + item.id, value: item.count });
                r.checked = Number(self.state.limit) === Number(item.count);
                self.listen(r, 'click', null, function () {
                    self.setLimit(item.count);
                    if (isFn(lim.onSelect)) { lim.onSelect.call(self, item, self); }
                });
                var label = make('<label></label>');
                attr(label, 'for', 'table-option-row-btn-' + item.id);
                setText(label, item.count);
                block.appendChild(append(make('<div class="table-options-row"></div>'),
                    append(make('<span class="table-options-key"></span>'), label),
                    append(make('<span class="table-options-value"></span>'), r)));
            });
            if (lim.custom) {
                var c = extend({ label: t('Custom'), placeholder: '', max: 10000, invalid: null }, lim.custom);
                var ci = make('<input id="table-option-custom-input" type="text" name="TableOptionCustomValue" value="" class="table-options-custom-input" />');
                attr(ci, 'placeholder', c.placeholder);
                var cr = make('<input id="table-option-custom-radio" type="radio" name="TableOptionValue" value="custom" />');
                attr(cr, 'aria-label', c.label);
                var valid = function (v) { var n = parseInt(v, 10); return !isNaN(n) && n > 0 && n <= c.max ? n : null; };
                var apply = function () {
                    var v = trim(ci.value);
                    if (v === '') { return; }
                    var n = valid(v);
                    if (n !== null) {
                        find(d, 'input[name="TableOptionValue"]').forEach(function (x) { x.checked = false; });
                        cr.checked = true;
                        self.setLimit(n);
                    } else {
                        window.alert(c.invalid || t('Please enter a valid number between 1 and %max', { '%max': c.max }));
                        cr.checked = false;
                        ci.value = '';
                    }
                };
                this.listen(ci, 'keydown', null, function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); apply(); } });
                this.listen(ci, 'blur', null, apply);
                this.listen(cr, 'click', null, function () {
                    var n = valid(trim(ci.value));
                    if (n !== null) { self.setLimit(n); }
                });
                var customLabel = make('<label for="table-option-custom-input"></label>');
                setText(customLabel, c.label);
                block.appendChild(append(make('<div class="table-options-row"></div>'),
                    append(make('<span class="table-options-key"></span>'), customLabel),
                    append(make('<span class="table-options-value table-options-custom-value"></span>'), ci, ' ', cr)));
            }
            bd.appendChild(fs);
        }
        if (to.presets) {
            this.presetsFieldset = make('<fieldset class="exp-dt-presets"></fieldset>');
            if (lim) { append(bd, '<br />'); }
            bd.appendChild(this.presetsFieldset);
            this.renderPresets();
        }
        if (to.columns) {
            var C = to.columns;
            var columnsLegend = make('<legend></legend>');
            setText(columnsLegend, C.legend || t('Visible table columns:'));
            var cf = append(make('<fieldset class="exp-dt-columns"></fieldset>'), columnsLegend);
            if (C.filter) {
                var F = extend({ label: t('Find a column'), placeholder: '' }, C.filter === true ? {} : C.filter);
                var fi = make('<input type="search" class="exp-dt-column-filter" autocomplete="off" />');
                attrs(fi, { id: ids + '-filter', placeholder: F.placeholder });
                var filterLabel = make('<label></label>');
                attr(filterLabel, 'for', ids + '-filter');
                setText(filterLabel, F.label);
                cf.appendChild(append(make('<div class="exp-dt-column-filter-row"></div>'), filterLabel, ' ', fi));
                this.listen(fi, 'input', null, function () { self.filterOptionColumns(fi.value); });
                this.listen(fi, 'keydown', null, function (e) { if (e.key === 'Enter') { e.preventDefault(); } });
                this.columnFilter = fi;
            }
            this.columnList = make('<div class="block exp-dt-column-list"></div>');
            cf.appendChild(this.columnList);
            if (lim || to.presets) { append(bd, '<br />'); }
            bd.appendChild(cf);
            var ct = this.o.columnToggle || {};
            if (ct.ordered) {
                var Or = extend({ legend: t('Order of the shown columns:'), hint: t('Drag a column, or use its buttons.') }, C.order || {});
                var orderLegend = make('<legend></legend>');
                setText(orderLegend, Or.legend);
                var of = append(make('<fieldset class="exp-dt-order-fieldset"></fieldset>'), orderLegend);
                if (Or.hint) {
                    var hint = make('<p class="exp-dt-order-hint"></p>');
                    setText(hint, Or.hint);
                    of.appendChild(hint);
                }
                this.orderList = make('<ol class="exp-dt-order"></ol>');
                of.appendChild(this.orderList);
                append(bd, '<br />', of);
                this.bindOrderList();
            }
            this.renderOptionColumns();
        }
        var close = make('<button type="button" class="exp-dt-dialog-close"></button>');
        setText(close, to.close || t('Close'));
        var footer = make('<div class="exp-dt-dialog-footer"></div>');
        (to.buttons || []).forEach(function (b) {
            var button = make('<button type="button" class="exp-dt-dialog-close exp-dt-dialog-button"></button>');
            setText(button, b.label || '');
            if (b.id) { attr(button, 'id', b.id); }
            if (b.title) { attr(button, 'title', b.title); }
            self.listen(button, 'click', null, function (e) { e.preventDefault(); if (isFn(b.onClick)) { b.onClick.call(self, self, self.userEvent(e)); } });
            append(footer, button, ' ');
        });
        d.appendChild(append(footer, close));
        if (to.presets || (to.columns && (to.columns.filter || (this.o.columnToggle || {}).ordered))) { addClass(d, 'exp-dt-dialog-wide'); }
        this.listen(close, 'click', null, function () { self.closeOptions(); });
        this.listen(d, 'cancel', null, function (e) { e.preventDefault(); self.closeOptions(); });
        this.listen(d, 'keydown', null, function (e) { if (e.key === 'Escape') { e.preventDefault(); self.closeOptions(); } });
        this.listen(d, 'click', null, function (e) { if (e.target === d && to.backdropCloses) { self.closeOptions(); } });
        var host = to.container ? first(to.container) : this.root;
        if (host) { host.appendChild(d); }
        this.optionsDialog = d;
    };

    /** Keeps the focus on "the same" control when part of the dialog is drawn again. */
    function keepFocus(scope, draw) {
        var a = document.activeElement, sel = null;
        if (a && scope && scope.contains(a)) {
            var key = a.getAttribute('data-key') || a.value, role = a.getAttribute('data-role') || a.getAttribute('name');
            sel = { key: key, role: role };
        }
        draw();
        if (sel) {
            var enabled = function (el) { return el.matches(':enabled'); };
            var target = find(scope, '[data-role="' + sel.role + '"][data-key="' + sel.key + '"], [name="' + sel.role + '"][value="' + sel.key + '"]').filter(enabled)[0];
            if (!target) { target = find(scope, '[data-role="' + sel.role + '"]').filter(enabled)[0]; }
            if (target) { target.focus(); }
        }
    }

    /** Table options: the column check boxes, grouped by each column's group, and the order list. */
    DataTable.prototype.renderOptionColumns = function () {
        var self = this, cb = this.columnList, C = (this.o.tableOptions || {}).columns || {}, ct = this.o.columnToggle || {};
        if (!cb) { return; }
        keepFocus(cb, function () {
            empty(cb);
            var G = self.optionColumnGroups(), groups = G.groups, byGroup = G.byGroup;
            var grouped = groups.length > 1 || (groups.length === 1 && groups[0] !== '');
            groups.forEach(function (g, gi) {
                var target = cb;
                if (grouped) {
                    var gid = self.id + '-colgroup-' + gi;
                    target = make('<div class="exp-dt-column-group" role="group"></div>');
                    attr(target, 'aria-labelledby', gid);
                    cb.appendChild(target);
                    var h = make('<h3 class="exp-dt-column-group-title"></h3>');
                    attr(h, 'id', gid);
                    setText(h, g || C.otherGroup || t('Other'));
                    target.appendChild(h);
                }
                byGroup[g].forEach(function (entry) {
                    var col = entry.col, id = 'table-option-col-btn-' + entry.i;
                    var x = make('<input type="checkbox" name="TableOptionColumn" />');
                    attrs(x, { id: id, value: col.key });
                    x.checked = !col.hidden;
                    self.listen(x, 'click', null, function () {
                        var keys;
                        if (ct.ordered) {
                            keys = self.shownColumns().filter(function (k) { return k !== col.key; });
                            if (this.checked) { keys.push(col.key); }
                        } else {
                            keys = find(cb, 'input[name="TableOptionColumn"]:checked').map(function (i) { return i.value; });
                        }
                        self.setShown(keys);
                    });
                    var label = make('<label></label>');
                    attr(label, 'for', id);
                    setText(label, col.label);
                    if (col.title) { attr(label, 'title', col.title); }
                    var row = make('<div class="table-options-row"></div>');
                    attr(row, 'data-search', (col.label + ' ' + (col.group || '') + ' ' + (col.title || '')).toLowerCase());
                    target.appendChild(append(row, append(make('<span class="table-options-key"></span>'), label),
                                                   append(make('<span class="table-options-value"></span>'), x)));
                });
            });
            var none = make('<p class="exp-dt-column-none" hidden="hidden"></p>');
            setText(none, (C.filter && C.filter.none) || t('No columns found.'));
            cb.appendChild(none);
        });
        if (this.columnFilter) { this.filterOptionColumns(this.columnFilter.value); }
        this.renderOrderList();
    };

    /**
     * The columns Table options offers (they have a key and a label and can be toggled), by group in the order
     * the groups first appear: { groups: [name, ...], byGroup: { name: [ { col, i }, ... ] } }, i the column's
     * place in the defined order ('' is the group of columns without one).
     */
    DataTable.prototype.optionColumnGroups = function () {
        var groups = [], byGroup = {};
        this.defOrder.forEach(function (col, i) {
            if (!col.label || !col.key || col.toggle === false) { return; }
            var g = col.group || '';
            if (!Object.prototype.hasOwnProperty.call(byGroup, g)) { byGroup[g] = []; groups.push(g); }
            byGroup[g].push({ col: col, i: i });
        });
        return { groups: groups, byGroup: byGroup };
    };

    /** Shows only the column check boxes whose name (or group, or description) has the text. */
    DataTable.prototype.filterOptionColumns = function (text) {
        var needle = trim(text || '').toLowerCase(), cb = this.columnList, any = false;
        if (!cb) { return; }
        find(cb, '.table-options-row').forEach(function (row) {
            var on = !needle || row.getAttribute('data-search').indexOf(needle) !== -1;
            row.hidden = !on;
            if (on) { any = true; }
        });
        find(cb, '.exp-dt-column-group').forEach(function (group) {
            group.hidden = find(group, '.table-options-row').filter(function (row) { return !row.hidden; }).length === 0;
        });
        find(cb, '.exp-dt-column-none').forEach(function (p) { p.hidden = any; });
    };

    /** The shown columns in their order: drag one to another place, or move it with its up and down buttons. */
    DataTable.prototype.renderOrderList = function () {
        var self = this, ol = this.orderList;
        if (!ol) { return; }
        var O = extend({ up: t('Move %name up'), down: t('Move %name down') }, ((this.o.tableOptions || {}).columns || {}).order || {});
        keepFocus(ol, function () {
            empty(ol);
            var keys = self.shownColumns();
            keys.forEach(function (k, i) {
                var c = self.column(k), name = c.label || k;
                var li = make('<li class="exp-dt-order-item" draggable="true"></li>');
                attr(li, 'data-key', k);
                var label = make('<span class="exp-dt-order-label"></span>');
                setText(label, name);
                var up = make('<button type="button" class="exp-dt-order-up" data-role="exp-dt-order-up">↑</button>');
                attrs(up, { 'data-key': k, 'aria-label': O.up.replace('%name', name), title: O.up.replace('%name', name) });
                up.disabled = i === 0;
                var down = make('<button type="button" class="exp-dt-order-down" data-role="exp-dt-order-down">↓</button>');
                attrs(down, { 'data-key': k, 'aria-label': O.down.replace('%name', name), title: O.down.replace('%name', name) });
                down.disabled = i === keys.length - 1;
                append(li, make('<span class="exp-dt-order-handle" aria-hidden="true"></span>'), label, up, down);
                ol.appendChild(li);
            });
        });
    };

    DataTable.prototype.bindOrderList = function () {
        var self = this, ol = this.orderList, dragKey = null;
        var marks = 'exp-dt-drop-before exp-dt-drop-after';
        var clear = function () { find(ol, '.exp-dt-drop-before, .exp-dt-drop-after, .exp-dt-dragging').forEach(function (el) { removeClass(el, marks + ' exp-dt-dragging'); }); };
        var transfer = function (e) { return (e.originalEvent || e).dataTransfer; };
        this.listen(ol, 'click', 'button.exp-dt-order-up, button.exp-dt-order-down', function (e) {
            e.preventDefault();
            self.moveColumn(this.getAttribute('data-key'), this.classList.contains('exp-dt-order-up') ? -1 : 1);
        });
        this.listen(ol, 'dragstart', 'li.exp-dt-order-item', function (e) {
            dragKey = this.getAttribute('data-key');
            var dt = transfer(e);
            if (dt) { dt.effectAllowed = 'move'; try { dt.setData('text/plain', dragKey); } catch (x) { /* old browsers */ } }
            addClass(this, 'exp-dt-dragging');
        });
        this.listen(ol, 'dragover', 'li.exp-dt-order-item', function (e) {
            if (dragKey === null) { return; }
            e.preventDefault();
            var dt = transfer(e);
            if (dt) { dt.dropEffect = 'move'; }
            var item = this, r = item.getBoundingClientRect(), after = (e.originalEvent || e).clientY > r.top + r.height / 2;
            find(ol, '.exp-dt-drop-before, .exp-dt-drop-after').forEach(function (el) { if (el !== item) { removeClass(el, marks); } });
            toggleClass(item, 'exp-dt-drop-after', after);
            toggleClass(item, 'exp-dt-drop-before', !after);
        });
        this.listen(ol, 'drop', 'li.exp-dt-order-item', function (e) {
            if (dragKey === null) { return; }
            e.preventDefault();
            var target = this.getAttribute('data-key'), after = this.classList.contains('exp-dt-drop-after');
            var keys = self.shownColumns().filter(function (k) { return k !== dragKey; });
            var at = keys.indexOf(target);
            if (target !== dragKey && at !== -1) {
                keys.splice(after ? at + 1 : at, 0, dragKey);
                clear();
                dragKey = null;
                self.setShown(keys);
            }
        });
        this.listen(ol, 'dragend', null, function () { dragKey = null; clear(); });
    };

    /** Table options: choose a preset, save the shown columns as one, delete one of your own. */
    DataTable.prototype.renderPresets = function () {
        var self = this, fs = this.presetsFieldset, P = extend({
            legend: t('Column presets:'), none: t('No preset'), choose: t('Preset'), name: t('Name of the new preset'),
            saveAs: t('Save current as...'), remove: t('Delete'), items: [], current: null
        }, (this.o.tableOptions || {}).presets || {});
        if (!fs) { return; }
        var items = (isFn(P.items) ? P.items.call(this, this) : P.items) || [];
        var current = isFn(P.current) ? P.current.call(this, this) : P.current;
        var find1 = function (id) { for (var i = 0; i < items.length; i++) { if (String(items[i].id) === String(id)) { return items[i]; } } return null; };
        keepFocus(fs, function () {
            var legend = make('<legend></legend>');
            setText(legend, P.legend);
            append(empty(fs), legend);
            var sid = self.id + '-preset', nid = self.id + '-preset-name';
            var sel = make('<select class="exp-dt-preset-select" data-role="exp-dt-preset-select" data-key="s"></select>');
            attr(sel, 'id', sid);
            var noneOption = make('<option value=""></option>');
            setText(noneOption, P.none);
            sel.appendChild(noneOption);
            items.forEach(function (it) {
                var option = make('<option></option>');
                attr(option, 'value', it.id);
                setText(option, it.name);
                sel.appendChild(option);
            });
            sel.value = current !== null && current !== undefined && find1(current) ? String(current) : '';
            var del = make('<button type="button" class="exp-dt-dialog-close exp-dt-preset-delete" data-role="exp-dt-preset-delete" data-key="d"></button>');
            setText(del, P.remove);
            var syncDel = function () { var it = find1(sel.value); del.disabled = !(it && it.own); };
            syncDel();
            self.listen(sel, 'change', null, function () {
                syncDel();
                var it = find1(sel.value);
                if (it && isFn(P.onApply)) { P.onApply.call(self, it, self); }
            });
            self.listen(del, 'click', null, function () {
                var it = find1(sel.value);
                if (!it || !it.own || !isFn(P.onDelete)) { return; }
                Promise.resolve(P.onDelete.call(self, it, self)).then(function () { self.renderPresets(); });
            });
            var name = make('<input type="text" class="exp-dt-preset-name" data-role="exp-dt-preset-name" data-key="n" maxlength="60" />');
            attrs(name, { id: nid, placeholder: P.name });
            var save = make('<button type="button" class="exp-dt-dialog-close exp-dt-preset-save" data-role="exp-dt-preset-save" data-key="v"></button>');
            setText(save, P.saveAs);
            var doSave = function () {
                var value = trim(name.value);
                if (!value) { name.focus(); return; }
                if (!isFn(P.onSave)) { return; }
                Promise.resolve(P.onSave.call(self, value, self.shownColumns(), self)).then(function () { self.renderPresets(); });
            };
            self.listen(save, 'click', null, doSave);
            self.listen(name, 'keydown', null, function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doSave(); } });
            var chooseLabel = make('<label></label>');
            attr(chooseLabel, 'for', sid);
            setText(chooseLabel, P.choose);
            var nameLabel = make('<label class="exp-visually-hidden"></label>');
            attr(nameLabel, 'for', nid);
            setText(nameLabel, P.name);
            append(fs, append(make('<div class="exp-dt-preset-row"></div>'), chooseLabel, ' ', sel, ' ', del),
                       append(make('<div class="exp-dt-preset-row"></div>'), nameLabel, name, ' ', save));
        });
    };

    DataTable.prototype.openOptions = function () {
        if (!this.o.tableOptions) { return; }
        if (!this.optionsDialog) { this.buildOptions(); }
        var d = this.optionsDialog;
        this.optionsReturn = document.activeElement;
        if (!d.open) {
            if (isFn(d.showModal)) { d.showModal(); } else { d.setAttribute('open', 'open'); }
        }
        var target = d.querySelector('input:checked, input, button');
        if (target) { target.focus(); }
        this.emit('options', { open: true });
    };

    DataTable.prototype.closeOptions = function () {
        if (!this.optionsDialog) { return; }
        var d = this.optionsDialog;
        if (d.open) { if (isFn(d.close)) { d.close(); } else { d.removeAttribute('open'); } }
        if (this.optionsReturn && this.optionsReturn.focus && document.contains(this.optionsReturn)) { this.optionsReturn.focus(); }
        this.emit('options', { open: false });
    };

    DataTable.prototype.saveColumns = function (keys) {
        var ct = this.o.columnToggle || {};
        this.shownKeys = keys;
        if (isFn(ct.save)) { ct.save.call(this, keys, this); }
        else if (ct.pref) {
            Exp.prefs.set(ct.pref, keys.join(',')).catch(function (e) {
                if (window.console) { window.console.error('Exp.datatable: the columns were not saved', e); }
            });
        }
        this.emit('columns', { shown: keys.slice() });
    };

    DataTable.prototype.showColumn = function (key) { this.setColumnHidden(key, false); };
    DataTable.prototype.hideColumn = function (key) { this.setColumnHidden(key, true); };
    DataTable.prototype.setColumnHidden = function (key, hidden) {
        var c = this.column(key);
        if (!c) { return; }
        c.hidden = !!hidden;
        var i = this.columns.indexOf(c), th = find(this.head, 'th')[i];
        if (th) { th.hidden = !!hidden; }
        Array.prototype.forEach.call(this.body.children, function (tr) {
            if (tr.tagName === 'TR' && tr.cells[i]) { tr.cells[i].hidden = !!hidden; }
        });
        this.updateMessageSpan();
    };
    DataTable.prototype.visibleColumns = function () {
        return this.columns.filter(function (c) { return !c.hidden; }).map(function (c) { return c.key; });
    };
    /** The shown columns that can be toggled (they have a label), in the order they are shown. */
    DataTable.prototype.shownColumns = function () {
        return this.columns.filter(function (c) { return !c.hidden && c.label && c.toggle !== false; }).map(function (c) { return c.key; });
    };

    /**
     * Shows exactly the columns keys (the others with a label are hidden); with columnToggle.ordered also in that
     * order. A column with remote: true that was hidden loads the rows again (the server sends only shown columns),
     * any other change only draws the rows again. opts.save: false does not save the choice.
     */
    DataTable.prototype.setShown = function (keys, opts) {
        opts = opts || {};
        var self = this, ct = this.o.columnToggle || {}, beforeKeys = this.visibleColumns(), reload = false;
        keys = (keys || []).filter(function (k) { var c = self.column(k); return c && c.label && c.toggle !== false; });
        this.columns.forEach(function (c) {
            if (!c.label || c.toggle === false) { return; }
            var hide = keys.indexOf(c.key) === -1;
            if (!hide && c.hidden && c.remote) { reload = true; }
            c.hidden = hide;
        });
        if (ct.ordered) { this.applyOrder(keys); }
        this.shownKeys = keys.slice();
        if (this.visibleColumns().join(',') !== beforeKeys.join(',') || reload) {
            this.cancelEdit();
            this.buildHead();
            this.updateMessageSpan();
            if (reload) { this.load(); } else { this.render(); }
        }
        if (this.optionsDialog) { this.renderOptionColumns(); }
        if (opts.save !== false) { this.saveColumns(keys); }
        return keys;
    };

    /** Moves a shown column by delta places (-1 earlier, 1 later) among the shown ones. */
    DataTable.prototype.moveColumn = function (key, delta) {
        var keys = this.shownColumns(), i = keys.indexOf(key), j = i + delta;
        if (i === -1 || j < 0 || j >= keys.length) { return false; }
        keys.splice(i, 1);
        keys.splice(j, 0, key);
        this.setShown(keys);
        return true;
    };

    // ---- copying a cell ----------------------------------------------------------------------------------

    DataTable.prototype.copyTexts = function () {
        return extend({ title: t('Click to copy'), done: t('Copied'), failed: t('Not copied') }, this.o.copy || {});
    };

    /** The text a copy cell puts on the clipboard: copy(row) when copy is a function, else the row's value. */
    DataTable.prototype.copyValue = function (c, row) {
        var v = isFn(c.copy) ? c.copy.call(this, row, c, this) : row[c.key];
        if (v === undefined || v === null) { return ''; }
        if (typeof v === 'object') { v = Array.isArray(v) ? v.join(', ') : JSON.stringify(v); }
        return String(v);
    };

    /** Puts the cell's value on the clipboard and says so in a small confirmation; a Promise of true or false. */
    DataTable.prototype.copyCell = function (td) {
        td = first(td);
        var tr = td && td.closest('tr'), row = this.rowData(tr), c = td && this.column(td.getAttribute('data-key'));
        if (!row || !c || !c.copy) { return Promise.resolve(false); }
        var self = this, text = this.copyValue(c, row), T = this.copyTexts();
        var fallback = function () {
            var ta = document.createElement('textarea'), ok = false;
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            return ok;
        };
        var p = window.navigator.clipboard && window.isSecureContext !== false
            ? window.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); })
            : Promise.resolve(fallback());
        return p.then(function (ok) {
            find(td, '.exp-dt-copied').forEach(remove);
            var note = make('<span class="exp-dt-copied" aria-hidden="true"></span>');
            toggleClass(note, 'exp-dt-copy-failed', !ok);
            setText(note, ok ? T.done : T.failed);
            td.appendChild(note);
            window.setTimeout(function () { remove(note); }, 1400);
            self.announce(ok ? T.done : T.failed);
            self.emit('copy', { row: row, key: c.key, text: text, copied: ok });
            return ok;
        });
    };

    // ---- data ----------------------------------------------------------------------------------------------

    DataTable.prototype.stateCopy = function () {
        var s = this.state;
        return { offset: s.offset, limit: s.limit, sort: s.sort ? { key: s.sort.key, dir: s.sort.dir } : null, filter: s.filter, page: this.page() };
    };

    /** The source as a function of the state: a Promise of {rows, total, offset}. */
    DataTable.prototype.fetch = function (state) {
        var src = this.o.source, self = this;
        if (isFn(src)) { try { return Promise.resolve(src.call(this, state, this)); } catch (e) { return Promise.reject(e); } }
        if (!src) { return Promise.resolve({ rows: [], total: 0 }); }
        if (src.dom || src.rows) {
            var rows = (src.dom ? this.domRows : src.rows).slice();
            if (state.filter) {
                var needle = String(state.filter).toLowerCase(), keys = src.filterKeys || this.columns.map(function (c) { return c.key; });
                rows = rows.filter(function (r) { return keys.some(function (k) { return r[k] !== undefined && String(r[k]).toLowerCase().indexOf(needle) !== -1; }); });
            }
            if (state.sort) {
                var k = state.sort.key, m = state.sort.dir === 'desc' ? -1 : 1;
                rows = rows.map(function (r, i) { return [r, i]; }).sort(function (a, b) { return compareValues(a[0][k], b[0][k]) * m || a[1] - b[1]; }).map(function (x) { return x[0]; });
            }
            var total = rows.length;
            return Promise.resolve({ rows: state.limit ? rows.slice(state.offset, state.offset + state.limit) : rows, total: total });
        }
        var parse = isFn(src.parse) ? src.parse : function (r) { return { rows: r.rows || r.list || [], total: r.total !== undefined ? r.total : (r.rows || r.list || []).length }; };
        var request, key;
        if (src.fn) {
            var args = isFn(src.args) ? src.args.call(this, state, this) : (src.args || []);
            var data = isFn(src.data) ? src.data.call(this, state, this) : src.data;
            key = src.fn + '::' + JSON.stringify(args) + '::' + JSON.stringify(data || null);
            request = function () { return Exp.io.call(src.fn, args, { method: src.method || 'POST', data: data }); };
        } else {
            var url = isFn(src.url) ? src.url.call(this, state, this) : src.url;
            var params = isFn(src.data) ? src.data.call(this, state, this) : src.data;
            key = url + '::' + JSON.stringify(params || null);
            request = function () {
                return new Promise(function (resolve, reject) {
                    // through jQuery when the page has it, as before; else fetch, sent the same way
                    var opts = { url: url, method: src.method || 'GET', data: params, dataType: 'json', timeout: src.timeout || 0 };
                    (self.jq ? self.jq.ajax(opts) : Exp.util.request(opts))
                        .then(function (json) { resolve(json); }, function (xhr, status) {
                            status = status === undefined ? xhr.textStatus : status;
                            var e = new Error(status === 'timeout' ? t('No answer from the server.') : t('The server answered with an error (HTTP %status).', { '%status': xhr.status }));
                            e.status = xhr.status; e.kind = status === 'timeout' ? 'timeout' : (xhr.status ? 'server' : 'network'); e.response = xhr;
                            reject(e);
                        });
                });
            };
        }
        var max = Number(src.cache) || 0;
        if (max && Object.prototype.hasOwnProperty.call(this.cache, key)) {
            return Promise.resolve(this.cache[key]);
        }
        return request().then(function (raw) {
            var res = parse.call(self, raw, state, self) || { rows: [], total: 0 };
            if (max) {
                self.cache[key] = res;
                self.cacheOrder.push(key);
                while (self.cacheOrder.length > max) { delete self.cache[self.cacheOrder.shift()]; }
            }
            return res;
        });
    };

    DataTable.prototype.flushCache = function () { this.cache = {}; this.cacheOrder = []; };

    DataTable.prototype.showMessage = function (text, cls) {
        var td = this.message.querySelector('td');
        attr(td, 'class', cls || '');
        setText(td, text);
        this.updateMessageSpan();
        this.message.hidden = false;
    };
    DataTable.prototype.hideMessage = function () { this.message.hidden = true; };
    DataTable.prototype.updateMessageSpan = function () {
        attr(this.message.querySelector('td'), 'colspan', Math.max(1, this.visibleColumns().length));
    };

    /** Loads the rows for the current state; a Promise of the result. */
    DataTable.prototype.load = function () {
        var self = this, state = this.stateCopy(), seq = ++this.seq;
        this.cancelEdit();
        this.table.setAttribute('aria-busy', 'true');
        var timer = window.setTimeout(function () { self.showMessage(self.texts.loading, 'exp-dt-loading'); }, 0);
        return this.fetch(state).then(function (res) {
            window.clearTimeout(timer);
            if (seq !== self.seq) { return res; }
            self.table.removeAttribute('aria-busy');
            self.total = Number(res.total) || 0;
            if (typeof res.offset === 'number' && res.offset >= 0) { self.state.offset = res.offset; }
            self.rowsData = res.rows || [];
            self.render();
            self.renderPagers();
            if (isFn(self.o.onLoad)) { self.o.onLoad.call(self, res, self); }
            self.emit('load', { rows: self.rowsData, total: self.total, state: self.stateCopy(), meta: res.meta });
            return res;
        }, function (err) {
            window.clearTimeout(timer);
            if (seq !== self.seq) { return null; }
            self.table.removeAttribute('aria-busy');
            self.showMessage(err && err.kind === 'signedout' ? err.message : self.texts.error, 'exp-dt-error');
            self.emit('error', { error: err, state: state });
            if (window.console) { window.console.warn('Exp.datatable: the rows were not loaded', err && err.message); }
            return null;
        });
    };
    DataTable.prototype.reload = DataTable.prototype.load;

    /** One cell's content; td: the cell (in jQuery as well, as the jQuery version took it). */
    DataTable.prototype.renderCell = function (c, row, td) {
        td = td && td.jquery ? td[0] : td;
        if (this.select && c.key === this.select.key) {
            var s = this.select, value = isFn(s.value) ? s.value(row) : row[this.o.rowKey || 'id'];
            var box = make('<input type="checkbox" />');
            attr(box, 'value', value);
            if (s.className) { addClass(box, s.className); }
            if (s.name) { attr(box, 'name', s.name); }
            var label = isFn(s.label) ? s.label(row) : null;
            if (label) { attr(box, 'aria-label', t('Select %name', { '%name': label })); }
            td.appendChild(box);
            return;
        }
        if (isFn(c.render)) {
            var out = c.render.call(this, row, this.wrap(td), this);
            if (out === undefined || out === null) { return; }
            if (typeof out === 'string') { td.innerHTML = out; } else { append(td, out); }
            return;
        }
        var v = row[c.key];
        if (c.format === 'date') { v = v === null || v === undefined || v === '' ? '' : formatDate(v, c.dateFormat || this.o.dateFormat); }
        setText(td, v === null || v === undefined ? '' : String(v));
    };

    DataTable.prototype.canEdit = function (row) {
        var ie = this.o.inlineEdit;
        return !!ie && (!isFn(ie.canEdit) || !!ie.canEdit.call(this, row, this));
    };

    DataTable.prototype.render = function () {
        var self = this, rows = this.rowsData, rk = this.o.rowKey;
        this.lastChecked = null;
        if (this.o.source && this.o.source.dom) {
            Array.prototype.slice.call(this.body.children).forEach(function (tr) { if (tr.tagName === 'TR') { remove(tr); } });
            rows.forEach(function (r) { self.body.appendChild(r._tr); });
        } else {
            var frag = document.createDocumentFragment();
            rows.forEach(function (row, ri) {
                var tr = document.createElement('tr');
                tr.className = ri % 2 ? 'exp-dt-odd' : 'exp-dt-even';
                if (ri === 0) { tr.className += ' exp-dt-row-first'; }
                if (rk && row[rk] !== undefined) { tr.setAttribute('data-row-key', row[rk]); }
                rowsOf.set(tr, row);
                if (self.jq) { self.jq.data(tr, 'expRow', row); }
                self.columns.forEach(function (c) {
                    var td = document.createElement('td');
                    td.setAttribute('data-key', c.key);
                    td.className = 'exp-dt-col-' + c.key + alignClass(c) + (c.className ? ' ' + c.className : '');
                    if (c.hidden) { td.hidden = true; }
                    self.renderCell(c, row, td);
                    if (c.copy && self.copyValue(c, row) !== '') {
                        td.className += ' exp-dt-copy';
                        td.tabIndex = 0;
                        td.title = self.copyTexts().title;
                    }
                    if (editableType(c) && self.canEdit(row)) {
                        td.className += ' exp-dt-editable';
                        td.tabIndex = 0;
                        td.setAttribute('aria-label', (c.label || c.key) + ': ' + td.textContent + '. ' + t('Press Enter to edit'));
                    }
                    tr.appendChild(td);
                });
                frag.appendChild(tr);
            });
            empty(this.body).appendChild(frag);
        }
        if (rows.length) { this.hideMessage(); } else { this.showMessage(this.texts.empty, 'exp-dt-empty'); }
        this.syncAll();
        if (isFn(this.o.onRender)) { this.o.onRender.call(this, this); }
    };

    DataTable.prototype.rows = function () { return this.rowsData.slice(); };

    // ---- state changes ---------------------------------------------------------------------------------

    DataTable.prototype.setPage = function (page) {
        if (this.paging.off || !this.state.limit) { return Promise.resolve(null); }
        var pages = this.pages();
        page = Math.max(1, Math.min(Number(page) || 1, pages || 1));
        var offset = normalizeOffset((page - 1) * this.state.limit, this.total, this.state.limit);
        if (offset === this.state.offset) { return Promise.resolve(null); }
        this.state.offset = offset;
        this.emit('page', { page: page, offset: offset, limit: this.state.limit });
        this.announce(t('Page %page of %pages', { '%page': page, '%pages': pages }));
        return this.load();
    };

    DataTable.prototype.setLimit = function (limit) {
        limit = Number(limit);
        if (this.paging.off || !(limit > 0) || limit === this.state.limit) { return Promise.resolve(null); }
        this.state.offset = normalizeOffset(this.state.offset, this.total, limit);
        this.state.limit = limit;
        if (this.optionsDialog) {
            find(this.optionsDialog, 'input[name="TableOptionValue"]').forEach(function (r) {
                if (r.value !== 'custom' && Number(r.value) === limit) { r.checked = true; }
            });
        }
        this.emit('page', { page: this.page(), offset: this.state.offset, limit: limit });
        return this.load();
    };

    /** Sorts by a column; dir omitted: the opposite of the current direction when sorted by it, else ascending. */
    DataTable.prototype.sortBy = function (key, dir) {
        var c = this.column(key);
        if (!c || !c.sortable) { return Promise.resolve(null); }
        var s = this.state.sort;
        if (!dir) { dir = s && s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : (c.sortDir || 'asc'); }
        this.state.sort = { key: key, dir: dir };
        this.state.offset = 0;
        this.updateSortHeads();
        this.emit('sort', { key: key, dir: dir });
        this.announce(t(dir === 'asc' ? 'Sorted by %column, ascending' : 'Sorted by %column, descending', { '%column': c.label || key }));
        return this.load();
    };

    DataTable.prototype.setFilter = function (text) {
        text = String(text === undefined || text === null ? '' : text);
        if (this.filterInput && this.filterInput.value !== text) { this.filterInput.value = text; }
        this.state.filter = text;
        this.state.offset = 0;
        this.emit('filter', { filter: text });
        return this.load();
    };

    DataTable.prototype.announce = function (text) {
        var status = this.status;
        status.textContent = '';
        window.setTimeout(function () { status.textContent = text; }, 50);
    };

    /** An event: on the element (with jQuery through it as well) and page-wide through Exp.emit(). */
    DataTable.prototype.emit = function (what, data) {
        data = extend({ table: this.el }, data);
        fire(this.el, 'exp:datatable:' + what, data, this.jq);
        Exp.emit('exp:datatable:' + what, data);
    };

    // ---- selection ---------------------------------------------------------------------------------------

    DataTable.prototype.checkboxes = function () {
        var s = this.select;
        return s ? find(this.body, 'td[data-key="' + s.key + '"] input[type=checkbox]') : [];
    };
    /** The selection check boxes of the rows (in jQuery through $.fn.expDataTable). */
    DataTable.prototype.checks = function () { return this.wrap(this.checkboxes()); };
    DataTable.prototype.selected = function () {
        var self = this;
        return this.checkboxes().filter(function (c) { return c.checked; })
            .map(function (c) { return self.rowData(c.closest('tr')); })
            .filter(function (row) { return row !== null && row !== undefined; });
    };
    DataTable.prototype.selectAll = function (on) {
        this.checkboxes().forEach(function (c) { c.checked = on !== false; });
        this.syncAll();
        this.emitSelect();
    };
    DataTable.prototype.invert = function () {
        this.checkboxes().forEach(function (c) { c.checked = !c.checked; });
        this.syncAll();
        this.emitSelect();
    };
    DataTable.prototype.syncAll = function () {
        var c = this.checkboxes(), n = c.filter(function (x) { return x.checked; }).length;
        c.forEach(function (x) { var tr = x.closest('tr'); if (tr) { toggleClass(tr, 'exp-dt-selected', x.checked); } });
        if (this.checkAll) {
            this.checkAll.checked = c.length > 0 && n === c.length;
            this.checkAll.indeterminate = n > 0 && n < c.length;
        }
    };
    DataTable.prototype.emitSelect = function () {
        var rows = this.selected();
        this.emit('select', { selected: rows, count: rows.length });
    };

    // ---- inline editing -----------------------------------------------------------------------------------

    DataTable.prototype.edit = function (td) {
        td = first(td);
        if (!td) { return; }
        var tr = td.closest('tr'), row = this.rowData(tr), key = td.getAttribute('data-key');
        var c = this.column(key), et = c && editableType(c);
        if (!row || !et || !this.canEdit(row)) { return; }
        if (this.editing && this.editing.td === td) { return; }
        this.commitEdit();
        var self = this, old = row[key];
        var input = make('<input type="text" class="exp-dt-editor" />');
        attr(input, 'aria-label', c.label || key);
        input.value = old === null || old === undefined ? '' : String(old);
        // over the cell, as the classic cell editor was: the value stays in the cell beneath it until it is saved
        addClass(td, 'exp-dt-editing');
        td.appendChild(input);
        this.editing = { td: td, input: input, row: row, key: key, old: old, column: c, type: et };
        if (this.jq) { this.editing.$in = this.jq(input); }
        this.listen(input, 'keydown', null, function (e) {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); self.commitEdit(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); self.cancelEdit(true); }
        });
        this.listen(input, 'focusout', null, function () {
            window.setTimeout(function () { if (self.editing && self.editing.input === input && document.activeElement !== input) { self.commitEdit(); } }, 0);
        });
        input.focus();
        input.select();
    };

    DataTable.prototype.endEdit = function (show, focus) {
        var ed = this.editing;
        if (!ed) { return; }
        this.editing = null;
        removeClass(ed.td, 'exp-dt-editing');
        remove(ed.input);
        if (show !== undefined) { empty(ed.td); this.renderCell(ed.column, ed.row, ed.td); }
        if (focus) { ed.td.focus(); }
    };

    DataTable.prototype.cancelEdit = function (focus) {
        if (this.editing) { this.endEdit(undefined, focus); }
    };

    /** Validates and saves the open editor; an invalid value puts the old one back and keeps the editor open. */
    DataTable.prototype.commitEdit = function () {
        var ed = this.editing;
        if (!ed) { return; }
        var raw = ed.input.value, value = raw;
        if (ed.type.type === 'number') { value = validateNumber(raw); }
        if (isFn(ed.type.validate)) { value = ed.type.validate(raw, ed.old, ed.row); }
        if (value === undefined) {
            ed.input.value = ed.old === null || ed.old === undefined ? '' : String(ed.old);
            this.emit('invalid', { row: ed.row, key: ed.key, value: raw });
            return;
        }
        var self = this, row = ed.row, key = ed.key, old = ed.old, td = ed.td, refocus = document.activeElement === ed.input;
        row[key] = value;
        this.endEdit(true, refocus);
        var ie = this.o.inlineEdit, p;
        if (isFn(ie.save)) { p = ie.save.call(this, row, key, value, this); }
        else if (ie.fn) {
            var data = isFn(ie.data) ? ie.data.call(this, row, key, value, this) : ie.data;
            var args = isFn(ie.args) ? ie.args.call(this, row, key, value, this) : (ie.args || []);
            p = Exp.io.call(ie.fn, args, { method: 'POST', data: data });
        }
        this.emit('edit', { row: row, key: key, value: value, old: old });
        Promise.resolve(p).then(function () {
            self.flushCache();
            if (ie.reloadWhenSorted !== false && self.state.sort && self.state.sort.key === key) { self.load(); }
        }, function (err) {
            row[key] = old;
            if (document.contains(td)) { empty(td); self.renderCell(self.column(key), row, td); }
            self.announce((err && err.message) || self.texts.error);
            self.emit('error', { error: err, row: row, key: key, value: value });
            if (window.console) { window.console.warn('Exp.datatable: the change was not saved', err && err.message); }
        });
    };

    // ---- events ------------------------------------------------------------------------------------------

    var CONTROLS = 'a, input, button, select, textarea';

    DataTable.prototype.bind = function () {
        var self = this;
        // on the table, not the header: the header is built again when the columns change order
        this.listen(this.table, 'click', 'thead button.exp-dt-sort', function (e) {
            e.preventDefault();
            var th = this.closest('th');
            self.sortBy(th ? th.getAttribute('data-key') : undefined);
        });
        this.listen(this.table, 'click', 'thead input.exp-dt-check-all', function () { self.selectAll(this.checked); });
        // cells with copy: a click (or Enter / Space on the focused cell) puts the value on the clipboard
        this.listen(this.body, 'click', 'td.exp-dt-copy', function (e) {
            if (closest(e.target, CONTROLS)) { return; }
            self.copyCell(this);
        });
        this.listen(this.body, 'keydown', 'td.exp-dt-copy', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === this) { e.preventDefault(); self.copyCell(this); }
        });
        this.listen(this.body, 'click', 'td[data-key] input[type=checkbox]', function (e) {
            var td = this.closest('td');
            if (!self.select || !td || td.getAttribute('data-key') !== self.select.key) { return; }
            var all = self.checkboxes(), i = all.indexOf(this);
            if (self.select.ranges && e.shiftKey && self.lastChecked !== null && self.lastChecked < all.length) {
                var a = Math.min(i, self.lastChecked), b = Math.max(i, self.lastChecked), on = this.checked;
                all.slice(a, b + 1).forEach(function (x) { x.checked = on; });
            }
            self.lastChecked = i;
            self.syncAll();
            self.emitSelect();
        });
        this.listen(this.body, 'click', 'td.exp-dt-editable', function (e) {
            if (self.editing && self.editing.td === this) { return; }
            if (closest(e.target, CONTROLS)) { return; }
            self.edit(this);
        });
        if (this.o.keyboard) {
            this.listen(this.body, 'keydown', null, function (e) { self.bodyKey(e); });
        }
        this.listen(this.root, 'keydown.expdt', null, function (e) {
            if (e.key === 'Escape') { self.closeMenus(); }
        });
    };

    /** Keyboard in the rows: Enter or F2 edits a cell, arrows move between rows and cells, Home and End. */
    DataTable.prototype.bodyKey = function (e) {
        var target = e.target;
        if (matches(target, 'input.exp-dt-editor')) { return; }
        var td = closest(target, 'td'), tr = td && td.closest('tr');
        if (!td) { return; }
        if (matches(target, 'td.exp-dt-editable') && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); this.edit(td); return; }
        var focusables = function (cells) {
            var out = [];
            cells.forEach(function (cell) {
                if (cell.hasAttribute('tabindex')) { out.push(cell); }
                out.push.apply(out, find(cell, 'a[href], input, button, select, textarea'));
            });
            return out.filter(visible);
        };
        var go = function (row, index) {
            if (!row) { return false; }
            var f = focusables(row.cells[index] ? [row.cells[index]] : []);
            if (!f.length) { f = focusables(Array.prototype.filter.call(row.children, function (c) { return c.tagName === 'TD'; })); }
            if (f.length) { f[0].focus(); return true; }
            return false;
        };
        var idx = td.cellIndex;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (matches(target, 'select, textarea') || (matches(target, 'input') && !matches(target, '[type=checkbox], [type=radio]'))) { return; }
            if (go(e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling, idx)) { e.preventDefault(); }
        } else if ((e.key === 'Home' || e.key === 'End') && e.ctrlKey) {
            var parent = tr.parentNode;
            if (go(e.key === 'Home' ? parent.firstElementChild : parent.lastElementChild, idx)) { e.preventDefault(); }
        }
    };

    DataTable.prototype.destroy = function () {
        this.seq++;
        this.closeMenus();
        this.menus.forEach(function (m) { m.unlistenPage(); remove(m.group); });
        if (this.optionsDialog) { this.closeOptions(); remove(this.optionsDialog); }
        if (this.filterInput) {
            if (this.jq) { this.jq(this.filterInput).off('.expdt'); } else if (this.offFilter) { this.offFilter(); }
        }
        this.pagers.concat(this.compacts).forEach(remove);
        unstore(this, this.el);
        if (this.el.tagName === 'TABLE') { unstore(this, this.table); }
        else { removeClass(this.root, 'exp-dt'); empty(this.root); }
    };

    // ---- the jQuery properties of the jQuery version -------------------------------------------------------
    // $table, $body ... are the elements in jQuery while the page has it (undefined without jQuery or before the
    // part is built), for code written for $.fn.expDataTable

    function jqProperty(proto, name, prop, jqOf) {
        Object.defineProperty(proto, name, {
            configurable: true,
            get: function () { var jq = jqOf(this), v = this[prop]; return jq && v ? wrapIn(jq, v) : undefined; },
            set: function (v) { Object.defineProperty(this, name, { value: v, writable: true, configurable: true, enumerable: true }); }
        });
    }
    var TABLE_PARTS = {
        $el: 'el', $root: 'root', $scroll: 'scroller', $table: 'table', $head: 'head', $body: 'body', $message: 'message',
        $status: 'status', $all: 'checkAll', $toolbar: 'toolbarElement', $filter: 'filterInput', $options: 'optionsDialog',
        $presets: 'presetsFieldset', $columnList: 'columnList', $orderList: 'orderList', $columnFilter: 'columnFilter',
        $pagers: 'pagers', $compacts: 'compacts'
    };
    Object.keys(TABLE_PARTS).forEach(function (name) { jqProperty(DataTable.prototype, name, TABLE_PARTS[name], function (o) { return o.jq; }); });
    ['wrap', 'button', 'group', 'menu'].forEach(function (part) {
        jqProperty(MenuButton.prototype, '$' + part, part, function (o) { return o.table.jq; });
    });

    // ---- set up -------------------------------------------------------------------------------------------

    /**
     * Exp.datatable.create(el, options): sets up a table on el (an element or a selector; again, with the new
     * options, when it has one) and returns it. No jQuery needed: callbacks get elements.
     */
    function create(el, options) {
        el = first(el);
        if (!el) { return null; }
        var inst = get(el);
        if (inst) { inst.destroy(); }
        return new DataTable(el, options, { jq: Exp.$ || null, wrapped: false });
    }

    /**
     * Puts $.fn.expDataTable on a jQuery: Exp.$ when the file loads; call it for a jQuery the page loads later.
     * $(el).expDataTable(options) sets one up (again, with options); $(el).expDataTable('method', args...) calls one.
     */
    function install(jq) {
        if (!jq || !jq.fn || (jq.fn.expDataTable && jq.fn.expDataTable.exp)) { return false; }
        jq.fn.expDataTable = function (options) {
            var args = Array.prototype.slice.call(arguments, 1), out;
            this.each(function () {
                var inst = tables.get(this) || jq.data(this, 'expDataTable');
                if (typeof options === 'string') {
                    if (inst && isFn(inst[options])) {
                        var r = inst[options].apply(inst, args);
                        if (out === undefined) { out = r; }
                    }
                    return;
                }
                if (inst) { inst.destroy(); }
                new DataTable(this, options, { jq: jq, wrapped: true });
            });
            return out === undefined ? this : out;
        };
        jq.fn.expDataTable.exp = true;
        return true;
    }

    Exp.datatable = {
        DataTable: DataTable,
        create: create,
        get: get,
        install: install,
        formatDate: formatDate,
        validateNumber: validateNumber,
        normalizeOffset: normalizeOffset,
        pageRange: pageRange,
        escapeHtml: escapeHtml
    };

    install(Exp.$);

    Exp.register('datatable', function (target, options) {
        var el = target && target.jquery ? target[0] : target;
        var inst = get(el);
        if (inst) { inst.destroy(); }
        new DataTable(el, options.value !== undefined && Object.keys(options).length === 1 ? {} : options,
                      { jq: Exp.$ || null, wrapped: !!Exp.$ });
    });
}(window, document));
