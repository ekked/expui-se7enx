/*!
 * Exponential UI (expui) sticky — a toolbar that stays in view while the page scrolls, and a "back to top" link.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::sticky after exp::core. Keeps the edit toolbar in view the way the admin's fixed_toolbar.js did,
 * with the same behaviour, so the admin's styles and other extensions that read the
 * toolbar's state (ezautosave's preview) keep working:
 *
 *   Exp.sticky.start('#controlbar-top', {      or $('#controlbar-top').expSticky({ ... })
 *       form: '#editform, #ClassEdit',     only on pages with this form
 *       start: '#columns',                 the toolbar is fixed once this element's top scrolls under it
 *       className: 'controlbar-fixed',     the class the toolbar gets while fixed
 *       toTop: '.scroll-to-top',           faded in once the page is scrolled past the start, out above it
 *       scrollToStart: true,               on load, scroll to the start and focus the form's first text field
 *       toTopOpacity: 0.85, fade: 500      the link's opacity and its fade in ms (0 with reduced motion)
 *   });
 *
 * Exp.sticky.admin() wires the admin's edit forms with exactly those defaults; exp::sticky runs it when the page is
 * ready, and fixed_toolbar.js stands aside when it finds it (window.Exp.sticky).
 *
 * Without jQuery it runs on plain JavaScript (the fade through Exp.util.animate(), jQuery's rules). With jQuery 4 on
 * the page it runs on it, exactly as before: its listeners (scroll.expsticky, click.expsticky), its .animate() and
 * $(toolbar).data('expSticky'). Exp.sticky.get(toolbar) finds an instance either way.
 */
(function (window, document) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.config || !Exp.util) { return; }
    if (Exp.sticky && Exp.sticky.install) {
        // loaded twice: the first copy stays, with its toolbar
        Exp.sticky.install(Exp.$);
        return;
    }
    var util = Exp.util;

    var DEFAULTS = {
        form: '#editform, #ClassEdit', start: '#columns', className: 'controlbar-fixed', toTop: '.scroll-to-top',
        scrollToStart: true, toTopOpacity: 0.85, fade: 500
    };
    var instances = new WeakMap();

    function px(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
    /** jQuery's .addClass() / .removeClass(): several names separated by spaces */
    function classes(el, names, on) {
        String(names || '').split(/\s+/).filter(Boolean).forEach(function (n) {
            if (on) { el.classList.add(n); } else if (el.classList.contains(n)) { el.classList.remove(n); }
        });
    }

    /** The first element of a selector, an element, a list or jQuery; through jQuery when there is one. */
    function first(jq, target) {
        if (jq) { return jq(target).first()[0] || null; }
        if (!target) { return null; }
        if (typeof target === 'string') { return document.querySelector(target); }
        return target.nodeType || target === window ? target : target[0] || null;
    }

    /** jQuery's .css('height') and .css('top'), as the toolbar's height was read */
    function cssOf(jq, el, prop) {
        if (jq) { return jq(el).css(prop); }
        var cs = window.getComputedStyle(el), v = cs[prop];
        if (prop === 'height' && (v === 'auto' || v === '') && el.getClientRects().length) { return el.offsetHeight + 'px'; }
        return v;
    }

    /** jQuery's .offset().top */
    function offsetTop(el) {
        if (!el.getClientRects().length) { return 0; }
        return el.getBoundingClientRect().top + (el.ownerDocument.defaultView.pageYOffset || 0);
    }

    /** toolbar: an element; opts: see the header; jq: the jQuery it runs on (default Exp.$; null: none). */
    function Sticky(toolbar, opts, jq) {
        this.jq = jq = jq === undefined ? (Exp.$ || null) : jq;
        var o = this.opts = (jq ? jq.extend : util.extend)({}, DEFAULTS, opts);
        var form = first(jq, o.form), start = first(jq, o.start), toTop = first(jq, o.toTop);
        this.toolbar = toolbar || null;
        this.form = form;
        this.startElement = start;
        this.toTop = toTop;
        this.active = false;
        if (!toolbar || !form || !start) { return; }
        this.active = true;
        var fade = Exp.reducedMotion ? 0 : o.fade;
        var toolbarHeight = px(cssOf(jq, toolbar, 'height')) + px(cssOf(jq, toolbar, 'top'));
        var formY = this.formY = px(jq ? jq(start).offset().top : offsetTop(start)) - toolbarHeight;
        var fixed = true, shown = false;

        function show() {
            if (shown || !toTop) { return; }
            shown = true;
            if (jq) { jq(toTop).stop(true).css('display', '').animate({ opacity: o.toTopOpacity }, fade); return; }
            util.stop(toTop);
            toTop.style.display = '';
            util.animate(toTop, { opacity: o.toTopOpacity }, fade);
        }
        function hide() {
            if (!toTop) { return; }
            shown = false;
            var done = function () { if (!shown) { toTop.style.display = 'none'; } };
            if (jq) { jq(toTop).stop(true).animate({ opacity: 0 }, fade, done); return; }
            util.stop(toTop);
            util.animate(toTop, { opacity: 0 }, fade, done);
        }

        // the same order of tests as fixed_toolbar.js, so the toolbar behaves exactly as before
        function onScroll() {
            var y = window.scrollY || window.pageYOffset || 0;
            if (!fixed && y > formY) {
                classes(toolbar, o.className, true);
                fixed = true;
            } else if (y > formY + 20 && toTop) {
                show();
            } else if (fixed && y < formY) {
                classes(toolbar, o.className, false);
                fixed = false;
                hide();
            }
        }
        this.onScroll = onScroll;

        if (toTop) {
            toTop.style.opacity = '0';
            if (jq) { jq(toTop).on('click.expsticky', function () { hide(); }); } else { toTop.addEventListener('click', function () { hide(); }); }
        }
        if (jq) { jq(window).on('scroll.expsticky', onScroll); } else { window.addEventListener('scroll', onScroll); }
        if (o.scrollToStart && (window.scrollY || window.pageYOffset || 0) < formY) {
            window.scrollTo(0, formY + 1);
            // focused without scrolling again: on a page with scroll-padding-top (a fixed header) the browser would
            // scroll the field to the middle of the window and undo the scroll to the start
            var field = jq ? jq(form).find('input[type=text]:enabled').get(0) : form.querySelector('input[type=text]:enabled');
            if (field) {
                try { field.focus({ preventScroll: true }); } catch (e) { field.focus(); }
            }
        }
        onScroll();
        instances.set(toolbar, this);
        if (jq) { jq(toolbar).data('expSticky', this); }
    }

    /** The instance started on a toolbar (an element, a selector or jQuery), or null. */
    function get(toolbar) {
        var el = first(null, toolbar);
        return (el && instances.get(el)) || null;
    }

    /** Puts $.fn.expSticky on a jQuery: Exp.$ when the file loads; call it for a jQuery the page loads later. */
    function install(jq) {
        if (!jq || !jq.fn || (jq.fn.expSticky && jq.fn.expSticky.exp)) { return false; }
        jq.fn.expSticky = function (opts) {
            return this.each(function () { new Sticky(this, opts, jq); });
        };
        jq.fn.expSticky.exp = true;
        return true;
    }

    Exp.sticky = {
        /**
         * Starts it on a toolbar (an element, a selector or jQuery; the first one) with options; returns the
         * instance (active: false when the page has no form).
         */
        start: function (toolbar, opts) { var jq = Exp.$ || null; return new Sticky(first(jq, toolbar), opts, jq); },
        /** The admin's edit forms: #controlbar-top over #editform or #ClassEdit, as fixed_toolbar.js did. */
        admin: function () { return Exp.sticky.start('#controlbar-top'); },
        get: get,
        install: install,
        Sticky: Sticky
    };

    install(Exp.$);

    Exp.ready(function () { Exp.sticky.admin(); });
}(window, document));
