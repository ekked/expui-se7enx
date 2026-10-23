/*!
 * Exponential UI (expui) collapse — a menu or panel that collapses and expands, remembered per user.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::collapse after exp::core. Takes the configuration the admin templates give it, with the same
 * configuration, so a template moves over by changing one line:
 *
 *   Exp.collapse({
 *       link: '#rightmenu-showhide',             the element that collapses and expands
 *       collapsed: 0,                            the state the page was made in (0 or 1, "0" or "1")
 *       content: ['Hide', 'Show'] | false,       the link's HTML when expanded / collapsed; false: left alone
 *       elements: [{ selector: '#rightmenu', duration: 0.4,          duration in seconds
 *                    fullStyle: { width: '201px' }, collapsedStyle: { width: '18px' } }],
 *       pref: { name: 'admin_right_menu_show', values: [1, 0] },   saved after each change: values[collapsed]
 *       callback: function () {},                after each change; this: the instance
 *       beforecollapse, aftercollapse, beforeuncollapse, afteruncollapse: function () {}
 *   });
 *
 * A style value may be a function, called at the moment of the change. Sizes (px, em, rem, %, or plain numbers)
 * are animated; other values (no-repeat, unset) are set at once. With reduced motion everything is set at once.
 * The link gets aria-expanded. A link that is no control by itself (an <a> without href, a <span>) and has no role
 * also gets role="button" and tabindex="0", and Enter and Space toggle it.
 * $(link).expCollapse(conf) does the same with conf.link = this element.
 *
 * Without jQuery it runs on plain JavaScript (Exp.util.css() and Exp.util.animate(), jQuery's rules). With jQuery 4
 * on the page it runs on it, exactly as before: its listeners (so .trigger() reaches them), .animate(), .html(),
 * $(link).data('expCollapse') and the instance's $link. Exp.collapse.get(link) finds an instance either way.
 */
(function (window, document) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.config || !Exp.util) { return; }
    if (Exp.collapse && Exp.collapse.install) {
        // loaded twice: the first copy stays, with its instances
        Exp.collapse.install(Exp.$);
        return;
    }
    var util = Exp.util;

    var SIZE = /^-?\d*\.?\d+(px|em|rem|%)?$/;
    var instances = new WeakMap();

    function resolve(value) { return typeof value === 'function' ? value() : value; }

    /** Elements: a selector, an element, a list or jQuery; through jQuery when there is one (its selectors). */
    function nodes(jq, target) {
        if (jq) { return jq(target).toArray(); }
        if (!target) { return []; }
        if (typeof target === 'string') { return Array.prototype.slice.call(document.querySelectorAll(target)); }
        return target.nodeType ? [target] : Array.prototype.slice.call(target);
    }

    /** Splits a style map into what can be animated and what is set at once. */
    function split(styles) {
        var animate = {}, set = {}, any = false;
        Object.keys(styles || {}).forEach(function (name) {
            var v = resolve(styles[name]);
            if (typeof v === 'number' || SIZE.test(String(v))) { animate[name] = v; any = true; } else { set[name] = v; }
        });
        return { animate: animate, set: set, any: any };
    }

    /** A control by itself: a button, a link with href, a form field, a summary. */
    function isNative(el) {
        var tag = el.tagName.toLowerCase();
        return tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'summary'
            || ((tag === 'a' || tag === 'area') && el.hasAttribute('href'));
    }

    /** conf: see the header; jq: the jQuery it runs on (default Exp.$; null: none). */
    function Collapse(conf, jq) {
        var self = this;
        this.jq = jq = jq === undefined ? (Exp.$ || null) : jq;
        this.conf = (jq ? jq.extend : util.extend)({ content: false, elements: [] }, conf);
        this.conf.collapsed = Number(this.conf.collapsed) ? 1 : 0;
        // the links as elements; with jQuery also as jQuery ($link), as before
        this.links = nodes(jq, this.conf.link);
        if (jq) { this.$link = jq(this.conf.link); }
        var keydown = function (e) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                self.toggle();
            }
        };
        var click = function (e) {
            e.preventDefault();
            self.toggle();
        };
        // a link without href (or a span) is no control by itself: it becomes a button a keyboard can reach and use
        this.links.forEach(function (link) {
            if (isNative(link) || link.hasAttribute('role')) { return; }
            link.setAttribute('role', 'button');
            if (!link.hasAttribute('tabindex')) { link.setAttribute('tabindex', '0'); }
            if (jq) { jq(link).on('keydown.expcollapse', keydown); } else { link.addEventListener('keydown', keydown); }
        });
        this.links.forEach(function (link) { link.setAttribute('aria-expanded', self.conf.collapsed ? 'false' : 'true'); });
        if (jq) { this.$link.on('click.expcollapse', click); } else { this.links.forEach(function (link) { link.addEventListener('click', click); }); }
        this.links.forEach(function (link) { instances.set(link, self); });
        if (jq) { this.$link.data('expCollapse', this); }
    }

    Collapse.prototype.run = function (type, done) {
        var jq = this.jq, key = type === 'collapse' ? 'collapsedStyle' : 'fullStyle', called = false;
        var finish = function () { if (!called) { called = true; if (done) { done.call(this); } } }.bind(this);
        this.conf.elements.forEach(function (el, i) {
            var targets = nodes(jq, el.selector);
            if (!targets.length) { if (i === 0) { finish(); } return; }
            var s = split(el[key]);
            var ms = Exp.reducedMotion ? 0 : Math.round((el.duration || 0) * 1000);
            var now = !s.any || ms === 0;
            if (jq) {
                var $el = jq.merge(jq(), targets);   // a list into jQuery without jQuery() reading it as text
                $el.css(s.set);
                if (now) { $el.stop(true, true).css(s.animate); }
                else { $el.stop(true, true).animate(s.animate, { duration: ms, complete: i === 0 ? finish : undefined }); }
            } else {
                targets.forEach(function (t) { util.css(t, s.set); });
                targets.forEach(function (t) { util.stop(t, true); });
                targets.forEach(function (t) {
                    if (now) { util.css(t, s.animate); } else { util.animate(t, s.animate, ms, i === 0 ? finish : undefined); }
                });
            }
            if (now && i === 0) { finish(); }
        });
        if (!this.conf.elements.length) { finish(); }
    };

    Collapse.prototype.change = function (collapsed) {
        var c = this.conf, jq = this.jq, type = collapsed ? 'collapse' : 'uncollapse';
        if (c['before' + type]) { c['before' + type].call(this); }
        this.run(collapsed ? 'collapse' : 'uncollapse', c['after' + type]);
        c.collapsed = collapsed ? 1 : 0;
        this.links.forEach(function (link) { link.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); });
        if (Array.isArray(c.content)) {
            if (jq) { this.$link.html(c.content[c.collapsed]); }
            else { this.links.forEach(function (link) { link.innerHTML = c.content[c.collapsed]; }); }
        }
        if (c.pref && c.pref.name) {
            var values = c.pref.values || [0, 1];
            Exp.prefs.set(c.pref.name, values[c.collapsed]).catch(function (e) {
                if (window.console) { window.console.error('Exp.collapse: the state was not saved', e); }
            });
        }
        if (c.callback) { c.callback.call(this); }
        Exp.emit('exp:collapse', { link: this.links[0], collapsed: c.collapsed });
        return this;
    };

    Collapse.prototype.collapse = function () { return this.change(true); };
    Collapse.prototype.uncollapse = function () { return this.change(false); };
    Collapse.prototype.expand = Collapse.prototype.uncollapse;
    Collapse.prototype.toggle = function () { return this.change(!this.conf.collapsed); };

    /** The instance set up on a link (an element, a selector or jQuery), or null. */
    function get(link) {
        var el = nodes(null, link)[0];
        return (el && instances.get(el)) || null;
    }

    /**
     * Puts $.fn.expCollapse on a jQuery: Exp.$ when the file loads; call it for a jQuery the page loads later.
     * $(el).expCollapse(conf) sets one up on each element, with conf.link = that element.
     */
    function install(jq) {
        if (!jq || !jq.fn || (jq.fn.expCollapse && jq.fn.expCollapse.exp)) { return false; }
        jq.fn.expCollapse = function (conf) {
            return this.each(function () { new Collapse(jq.extend({}, conf, { link: this }), jq); });
        };
        jq.fn.expCollapse.exp = true;
        return true;
    }

    Exp.collapse = function (conf) { return new Collapse(conf); };
    Exp.collapse.Collapse = Collapse;
    Exp.collapse.get = get;
    Exp.collapse.install = install;

    install(Exp.$);
}(window, document));
