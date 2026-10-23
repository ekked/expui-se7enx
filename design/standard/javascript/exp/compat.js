/*!
 * Exponential UI (expui) compat — $.ez() over Exp.io, for code that is not ported yet.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 * Loaded by exp::compat after exp::io. Puts $.ez() (ezjscore's jqueryio API) on the page's jQuery, and on
 * Exp.$, as a wrapper over Exp.io: the same arguments (callArgs, post, callBack), the same request object back
 * (jqXHR: .done(), .fail(), .then()), the same url, root_url, seperator and setPreference(). Code written for
 * $.ez() keeps working while it is ported, and both talk to the server the same way.
 */
(function (window) {
    'use strict';

    var Exp = window.Exp;
    if (!Exp || !Exp.io) { return; }
    if (!Exp.$) {
        // $.ez() hands back a jqXHR: without jQuery 4 (exp::core::shared on a page that loads none) there is none
        if (window.console) { window.console.error('Exp: exp::compat needs jQuery 4, and this page has none; request ezjsc::jquery before exp::core::shared'); }
        return;
    }

    function install(jq) {
        if (!jq || (jq.ez && jq.ez.expCompat)) { return false; }
        var ez = function (callArgs, post, callBack) {
            var call = Array.isArray(callArgs) ? callArgs.join(Exp.config.separator) : String(callArgs);
            var request = Exp.io.raw(call, post ? { method: 'POST', data: post } : { method: 'GET' });
            if (typeof callBack === 'function') { request.done(callBack); }
            return request;
        };
        ez.url = Exp.config.call;
        ez.root_url = Exp.config.root;
        ez.seperator = Exp.config.separator;
        ez.setPreference = function (name, value) { return Exp.prefs.set(name, value); };
        ez.expCompat = true;
        jq.ez = ez;
        return true;
    }

    Exp.compat = { install: install };
    install(Exp.$);
    if (window.jQuery && window.jQuery !== Exp.$) { install(window.jQuery); }
}(window));
