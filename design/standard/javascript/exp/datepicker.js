/*!
 * Exponential UI (expui) datepicker — a calendar for the date and date/time fields.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::datepicker after exp::core. The calendar of the date templates:
 *
 *   Exp.datepicker.create(fieldset, {     or $(fieldset).expDatePicker({ ... })
 *       fields: { year: 'input[name$="_year_7"]', month: …, day: …, hour: …, minute: … },  the existing inputs stay
 *       button: '#calendar-icon',          what opens the calendar (default: a button added after the day field)
 *       min: '1970-01-01', max: null,      the dates that can be chosen (YYYY-MM-DD)
 *       firstDay: Exp.config.locale.firstDay   0 = Sunday, 1 = Monday
 *   });
 *   Exp.datepicker.open({ fields, anchor, container, min, max, firstDay, onSelect })   open one now
 *
 * Choosing a day fills the year, month and day fields as ezdatepicker.js did (numbers, no leading zero), sets the
 * hour to 12 and the minute to 00 when they are empty, closes the calendar and focuses the year field. The fields
 * keep their names, so what the form posts does not change.
 *
 * window.showDatePicker( base, id, datatype ), the function the date templates' calendar icon calls, opens this
 * calendar.
 *
 * Keyboard: arrows move a day or a week, Page Up / Page Down a month, Home / End the start or end of the week,
 * Enter or Space chooses, Escape closes and gives the focus back. The names of the months and days are the page
 * language's (Intl).
 *
 * Without jQuery it runs on plain JavaScript: the fields get their values and a native change event, and the events'
 * fields are elements. With jQuery 4 on the page it runs on it, exactly as before: its listeners, .trigger('change')
 * and .trigger('focus'), the events' fields in jQuery, $(fieldset).data('expDatePicker'). Exp.datepicker.create()
 * hands over elements on either page.
 */
(function (window, document) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.config || !Exp.util) { return; }
    if (Exp.datepicker && Exp.datepicker.install) {
        // loaded twice: the first copy stays, with its calendar
        Exp.datepicker.install(Exp.$);
        return;
    }
    var util = Exp.util;
    var PARTS = ['year', 'month', 'day', 'hour', 'minute'];

    var open = null;   // the calendar on the page (one at a time)
    var outside = [];  // the "click outside" listeners bound without jQuery
    var setUp = new WeakMap();

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parse(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    function sameDay(a, b) { return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
    function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
    function addMonths(d, n) {
        var t = new Date(d.getFullYear(), d.getMonth() + n, 1);
        var last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
        return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
    }

    function locale() { return (Exp.config.locale && Exp.config.locale.http) || 'en-GB'; }
    function format(d, opts) {
        try { return new Intl.DateTimeFormat(locale(), opts).format(d); } catch (e) { return new Intl.DateTimeFormat('en-GB', opts).format(d); }
    }

    // ---- the DOM, with jQuery where the page has it ---------------------------------------------------------

    /** The first element of a selector, an element, a list or jQuery (through jQuery when there is one), or null. */
    function first(jq, target) {
        if (jq) { return jq(target).first()[0] || null; }
        if (!target) { return null; }
        if (typeof target === 'string') { return document.querySelector(target); }
        return target.nodeType ? target : target[0] || null;
    }
    function make(tag, attrs, text) {
        var el = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
        if (text !== undefined) { el.textContent = String(text); }
        return el;
    }
    function remove(jq, el) { if (jq) { jq(el).remove(); } else if (el.parentNode) { el.parentNode.removeChild(el); } }
    function empty(jq, el) { if (jq) { jq(el).empty(); } else { while (el.firstChild) { el.removeChild(el.firstChild); } } }

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

    /** A field gets a value and a change event (jQuery's .val().trigger('change') where it is there). */
    function setValue(jq, el, value) {
        if (jq) { jq(el).val(value).trigger('change'); return; }
        el.value = String(value);
        el.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    function focus(jq, el) { if (jq) { jq(el).trigger('focus'); } else { el.focus(); } }

    // ---- the calendar ---------------------------------------------------------------------------------------

    /** The date the fields hold, or null. */
    function fromFields(f) {
        var y = parseInt(f.year.value, 10), m = parseInt(f.month.value, 10), d = parseInt(f.day.value, 10);
        if (!y || !m || !d) { return null; }
        var date = new Date(y, m - 1, d);
        return date.getMonth() === m - 1 ? date : null;
    }

    function close(giveFocus) {
        if (!open) { return; }
        var o = open;
        open = null;
        if (o.jq) { o.jq(document).off('.expdatepicker'); }
        outside.splice(0).forEach(function (fn) { document.removeEventListener('mousedown', fn); });
        remove(o.jq, o.el);
        if (o.container) { o.container.style.display = 'none'; }
        if (giveFocus && o.anchor && o.anchor.focus) { o.anchor.focus(); }
        Exp.emit('exp:datepicker:close', { fields: o.fields });
    }

    /**
     * Opens the calendar. opts: fields (selectors, elements or jQuery: year, month, day, optional hour, minute),
     * anchor (the element it opens from, which gets the focus back), container (where it is drawn; default: after the
     * anchor), min, max (YYYY-MM-DD), firstDay, onSelect(date). jq: the jQuery it runs on (null: none); wrapped: the
     * events' fields in jQuery (as before) instead of elements.
     */
    function openPicker(opts, jq, wrapped) {
        close(false);
        var f = {}, fields = {};
        PARTS.forEach(function (k) { f[k] = first(jq, opts.fields[k]); });
        if (!f.year || !f.month || !f.day) { return null; }
        // what the events hand over: the fields in jQuery (an empty one for a missing time) or the elements (null)
        PARTS.forEach(function (k) { fields[k] = wrapped ? (f[k] ? jq(f[k]) : jq()) : f[k]; });
        var min = parse(opts.min === undefined ? '1970-01-01' : opts.min), max = parse(opts.max);
        var firstDay = opts.firstDay === undefined ? (Exp.config.locale && Exp.config.locale.firstDay) || 0 : +opts.firstDay;
        var selected = fromFields(f), today = new Date();
        var focusDate = selected || today;
        if (min && focusDate < min) { focusDate = min; }
        if (max && focusDate > max) { focusDate = max; }

        var titleId = 'exp-datepicker-title-' + Date.now();
        var el = make('div', { 'class': 'exp-datepicker', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId });
        var head = make('div', { 'class': 'exp-datepicker-head' });
        var prev = make('button', { type: 'button', 'class': 'exp-datepicker-prev', 'aria-label': Exp.i18n('Previous month') }, '‹');
        var title = make('div', { 'class': 'exp-datepicker-title', 'aria-live': 'polite', id: titleId });
        var next = make('button', { type: 'button', 'class': 'exp-datepicker-next', 'aria-label': Exp.i18n('Next month') }, '›');
        var closer = make('button', { type: 'button', 'class': 'exp-datepicker-close', 'aria-label': Exp.i18n('Close') }, '×');
        head.appendChild(prev); head.appendChild(title); head.appendChild(next); head.appendChild(closer);
        var grid = make('table', { 'class': 'exp-datepicker-grid', role: 'grid', 'aria-labelledby': titleId });
        el.appendChild(head); el.appendChild(grid);

        function allowed(d) { return !(min && d < min) && !(max && d > max); }
        function dayButton(d) { return grid.querySelector('button[data-date="' + iso(d) + '"]'); }

        function draw() {
            title.textContent = format(focusDate, { month: 'long', year: 'numeric' });
            var firstOfMonth = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
            var start = addDays(firstOfMonth, -((firstOfMonth.getDay() - firstDay + 7) % 7));
            var thead = make('thead'), tr = thead.appendChild(make('tr'));
            for (var i = 0; i < 7; i++) {
                var wd = addDays(start, i);
                tr.appendChild(make('th', { scope: 'col', abbr: format(wd, { weekday: 'long' }) }, format(wd, { weekday: 'short' })));
            }
            var tbody = make('tbody');
            for (var w = 0; w < 6; w++) {
                var row = tbody.appendChild(make('tr'));
                for (var j = 0; j < 7; j++) {
                    var day = addDays(start, w * 7 + j);
                    var b = make('button', { type: 'button', 'class': 'exp-datepicker-day' }, day.getDate());
                    b.setAttribute('data-date', iso(day));
                    b.setAttribute('aria-label', format(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
                    b.setAttribute('tabindex', sameDay(day, focusDate) ? '0' : '-1');
                    if (day.getMonth() !== focusDate.getMonth()) { b.classList.add('is-other-month'); }
                    if (sameDay(day, today)) { b.classList.add('is-today'); b.setAttribute('aria-current', 'date'); }
                    if (sameDay(day, selected)) { b.classList.add('is-selected'); b.setAttribute('aria-pressed', 'true'); }
                    if (!allowed(day)) { b.disabled = true; }
                    row.appendChild(make('td', { role: 'gridcell' })).appendChild(b);
                }
            }
            empty(jq, grid);
            grid.appendChild(thead);
            grid.appendChild(tbody);
            prev.disabled = !!min && new Date(focusDate.getFullYear(), focusDate.getMonth(), 0) < min;
            next.disabled = !!max && new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 1) > max;
        }
        function focusDay() { var b = dayButton(focusDate); if (b) { focus(jq, b); } }
        function move(d) {
            if (min && d < min) { d = min; }
            if (max && d > max) { d = max; }
            var redraw = d.getMonth() !== focusDate.getMonth() || d.getFullYear() !== focusDate.getFullYear();
            focusDate = d;
            if (redraw) { draw(); } else {
                Array.prototype.forEach.call(grid.querySelectorAll('button.exp-datepicker-day'), function (b) { b.setAttribute('tabindex', '-1'); });
                var b = dayButton(focusDate);
                if (b) { b.setAttribute('tabindex', '0'); }
            }
            focusDay();
        }
        function choose(d) {
            if (!allowed(d)) { return; }
            // as ezdatepicker.js: numbers without leading zeros, 12:00 when no time was set
            setValue(jq, f.year, d.getFullYear());
            setValue(jq, f.month, d.getMonth() + 1);
            setValue(jq, f.day, d.getDate());
            if (f.hour && String(f.hour.value) === '') { setValue(jq, f.hour, '12'); }
            if (f.minute && String(f.minute.value) === '') { setValue(jq, f.minute, '00'); }
            var those = open ? open.fields : fields;
            close(false);
            focus(jq, f.year);
            if (opts.onSelect) { opts.onSelect(d); }
            Exp.emit('exp:datepicker:select', { date: iso(d), fields: those });
        }

        listen(jq, prev, 'click', null, function () { focusDate = addMonths(focusDate, -1); draw(); focus(jq, prev); });
        listen(jq, next, 'click', null, function () { focusDate = addMonths(focusDate, 1); draw(); focus(jq, next); });
        listen(jq, closer, 'click', null, function () { close(true); });
        listen(jq, grid, 'click', 'button.exp-datepicker-day', function () { choose(parse(this.getAttribute('data-date'))); });
        listen(jq, el, 'keydown', null, function (e) {
            var k = e.key;
            if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
            if (!e.target.classList || !e.target.classList.contains('exp-datepicker-day')) { return; }
            var map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (map[k] !== undefined) { e.preventDefault(); move(addDays(focusDate, map[k])); }
            else if (k === 'PageUp') { e.preventDefault(); move(addMonths(focusDate, e.shiftKey ? -12 : -1)); }
            else if (k === 'PageDown') { e.preventDefault(); move(addMonths(focusDate, e.shiftKey ? 12 : 1)); }
            else if (k === 'Home') { e.preventDefault(); move(addDays(focusDate, -((focusDate.getDay() - firstDay + 7) % 7))); }
            else if (k === 'End') { e.preventDefault(); move(addDays(focusDate, 6 - ((focusDate.getDay() - firstDay + 7) % 7))); }
            else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(focusDate); }
        });

        var container = opts.container ? first(jq, opts.container) : null;
        if (container) {
            empty(jq, container);
            container.appendChild(el);
            container.style.display = 'block';
        } else {
            var after = first(jq, opts.anchor || f.day);
            if (after && after.parentNode) { after.parentNode.insertBefore(el, after.nextSibling); }
        }
        open = { el: el, container: container, anchor: opts.anchor ? first(jq, opts.anchor) : f.day, fields: fields, jq: jq };
        // the calendar in jQuery, for code that read it from there
        if (jq) { open.$el = jq(el); }
        draw();
        focusDay();
        // a click outside closes it
        window.setTimeout(function () {
            var fn = function (e) {
                if (open && !(open.el !== e.target && open.el.contains(e.target)) && e.target !== open.anchor) { close(false); }
            };
            if (jq) { jq(document).on('mousedown.expdatepicker', fn); } else { outside.push(fn); document.addEventListener('mousedown', fn); }
        }, 0);
        Exp.emit('exp:datepicker:open', { fields: fields });
        return { close: function () { close(true); }, element: el };
    }

    /**
     * Sets up the fields inside box: a button (or options.button) that opens the calendar. Returns { button, fields }
     * (fields in jQuery when wrapped, as $.fn.expDatePicker kept them), or null without a year field.
     */
    function setup(box, options, jq, wrapped) {
        var o = (jq ? jq.extend : util.extend)({ min: '1970-01-01' }, options || {});
        var f = {}, kept = {};
        PARTS.forEach(function (k) {
            if (!o.fields || !o.fields[k]) { return; }
            f[k] = jq ? jq(box).find(o.fields[k]).first()[0] || null : box.querySelector(o.fields[k]);
            kept[k] = wrapped ? (f[k] ? jq(f[k]) : jq()) : f[k];
        });
        if (!f.year) { return null; }
        var button = o.button ? first(jq, o.button) : null;
        if (!button) {
            button = make('button', { type: 'button', 'class': 'exp-datepicker-button', 'aria-label': Exp.i18n('Choose a date') });
            button.innerHTML = '<svg class="exp-datepicker-icon" aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">'
                + '<path fill="currentColor" d="M4 0h1v2h6V0h1v2h3v14H1V2h3V0zM2 6v9h12V6H2zm1 1.5h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2zM3 11h2v2H3v-2zm4 0h2v2H7v-2z"/></svg>';
            if (f.day && f.day.parentNode) { f.day.parentNode.insertBefore(button, f.day.nextSibling); }
        }
        var fieldsOf = {};
        PARTS.forEach(function (k) { if (k in f) { fieldsOf[k] = wrapped ? kept[k] : f[k]; } });
        listen(jq, button, 'click', null, function (e) {
            e.preventDefault();
            openPicker((jq ? jq.extend : util.extend)({}, o, { fields: fieldsOf, anchor: button }), jq, wrapped);
        });
        var data = { button: button, fields: fieldsOf };
        setUp.set(box, data);
        if (jq && wrapped) { jq(box).data('expDatePicker', data); }
        return data;
    }

    /** What create() (or $.fn.expDatePicker) set up on box: { button, fields }, or null. */
    function get(box) {
        var el = first(null, box);
        return (el && setUp.get(el)) || null;
    }

    /** Puts $.fn.expDatePicker on a jQuery: Exp.$ when the file loads; call it for a jQuery the page loads later. */
    function install(jq) {
        if (!jq || !jq.fn || (jq.fn.expDatePicker && jq.fn.expDatePicker.exp)) { return false; }
        jq.fn.expDatePicker = function (options) {
            return this.each(function () { setup(this, options, jq, true); });
        };
        jq.fn.expDatePicker.exp = true;
        return true;
    }

    Exp.datepicker = {
        /** Opens a calendar now; on a page with jQuery the events' fields are in jQuery, as before. */
        open: function (opts) { return openPicker(opts, Exp.$ || null, !!Exp.$); },
        close: function () { close(true); },
        isOpen: function () { return !!open; },
        /** Exp.datepicker.create(box, options): the fields inside box get a calendar button; { button, fields } (elements). */
        create: function (box, options) { var el = first(null, box); return el ? setup(el, options, Exp.$ || null, false) : null; },
        get: get,
        install: install
    };

    install(Exp.$);

    // The date templates' calendar icon: <img onclick="showDatePicker( base, id, datatype )">, with the fields named
    // <base>_<datatype>_year_<id> and so on, and the container <base>_<datatype>_cal_container_<id>.
    window.showDatePicker = function (base, id, datatype) {
        var name = function (part) { return document.getElementsByName(base + '_' + datatype + '_' + part + '_' + id)[0] || null; };
        var icon = document.getElementById(base + '_' + datatype + '_cal_' + id);
        if (icon && !icon.hasAttribute('tabindex')) { icon.setAttribute('tabindex', '0'); }
        return Exp.datepicker.open({
            fields: { year: name('year'), month: name('month'), day: name('day'), hour: name('hour'), minute: name('minute') },
            anchor: icon,
            container: document.getElementById(base + '_' + datatype + '_cal_container_' + id),
            min: '1970-01-01'
        });
    };
    window.showDatePicker.exp = true;

    // the icon is an <img>: make it reachable and usable with the keyboard as well
    listen(Exp.$ || null, document, 'keydown', 'img.datepicker-icon[onclick]', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); }
    });
    Exp.ready(function () {
        Array.prototype.forEach.call(document.querySelectorAll('img.datepicker-icon[onclick]'), function (img) {
            img.setAttribute('tabindex', '0');
            img.setAttribute('role', 'button');
            if (!img.getAttribute('aria-label')) { img.setAttribute('aria-label', Exp.i18n('Choose a date')); }
        });
    });
}(window, document));
