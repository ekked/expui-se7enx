/*!
 * Exponential UI (expui) test runner: the unit tests of the Exp modules, in the browser, on a real page.
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 *
 *   ExpTest.test('name', async function (t) { t.ok(x); t.equal(a, b); await t.rejects(promise, 'kind'); });
 *
 * Results go into #exp-test-results and window.ExpTestResults ({done, passed, failed, skipped, tests: [...]}), which
 * the Playwright check reads. Tests run one after another, in the order they were added. ExpTest.bare() gives a frame
 * without jQuery for the tests of the plain JavaScript path.
 *
 * A test the page cannot run calls t.skip(reason): it is reported as skipped ("N/A", with the reason; passed: true,
 * skipped: true), counted in skipped, not in passed or failed. ExpTest.inlineScripts() says whether the page's Content
 * Security Policy lets inline scripts run (a <script> element without nonce, an on...= attribute): the server's
 * answer (data-inline-scripts on #exp-test-expected), else a probe.
 */
(function (window, document) {
    'use strict';

    var queue = [];
    var results = window.ExpTestResults = { done: false, passed: 0, failed: 0, skipped: 0, tests: [] };
    var inline = null;

    /** thrown by t.skip(): the test is not run here, for the reason given */
    function Skip(reason) { this.reason = String(reason || 'skipped'); }

    function Assert(name) { this.name = name; this.count = 0; }
    Assert.prototype.skip = function (reason) { throw new Skip(reason); };
    /** skips the test unless inline scripts run on this page (see inlineScripts()) */
    Assert.prototype.needsInlineScripts = function (what) {
        if (!inlineScripts()) {
            throw new Skip('N/A under enforced CSP: ' + what + ' needs inline scripts, which the page\'s Content Security Policy blocks (script-src without \'unsafe-inline\')');
        }
    };
    Assert.prototype.ok = function (value, message) {
        this.count++;
        if (!value) { throw new Error(message || 'expected a true value'); }
    };
    Assert.prototype.equal = function (actual, expected, message) {
        this.count++;
        if (actual !== expected) { throw new Error((message ? message + ': ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
    };
    Assert.prototype.deepEqual = function (actual, expected, message) {
        this.count++;
        var a = JSON.stringify(actual), e = JSON.stringify(expected);
        if (a !== e) { throw new Error((message ? message + ': ' : '') + 'expected ' + e + ', got ' + a); }
    };
    Assert.prototype.throws = function (fn, message) {
        this.count++;
        try { fn(); } catch (e) { return e; }
        throw new Error(message || 'expected an exception');
    };
    /** Awaits a Promise that must reject; kind: the Exp.io.Error kind it must have. */
    Assert.prototype.rejects = function (promise, kind, message) {
        this.count++;
        return promise.then(function () { throw new Error(message || 'expected a rejection'); },
                            function (e) { if (kind && (!e || e.kind !== kind)) { throw new Error((message ? message + ': ' : '') + 'expected kind ' + kind + ', got ' + (e && e.kind) + ' (' + (e && e.message) + ')'); } return e; });
    };

    /**
     * Whether inline scripts run on this page: false when the server says its enforced policy blocks them
     * (data-inline-scripts="0"), true when it says they run ("1"); without the server's answer (an older kernel, a
     * policy set by the web server) a probe: an on...= attribute that a policy without 'unsafe-inline' does not run.
     */
    function inlineScripts() {
        if (inline !== null) { return inline; }
        var expected = document.getElementById('exp-test-expected');
        var said = expected ? expected.getAttribute('data-inline-scripts') : null;
        if (said === '0' || said === '1') {
            inline = said === '1';
        } else {
            var probe = document.createElement('button');
            probe.type = 'button'; probe.hidden = true;
            probe.setAttribute('onclick', 'window.__expTestInlineProbe = true;');
            window.__expTestInlineProbe = false;
            document.body.appendChild(probe);
            probe.click();
            probe.parentNode.removeChild(probe);
            inline = window.__expTestInlineProbe === true;
            try { delete window.__expTestInlineProbe; } catch (e) { window.__expTestInlineProbe = undefined; }
        }
        return inline;
    }

    function row(test) {
        var list = document.getElementById('exp-test-results');
        if (!list) { return; }
        var li = document.createElement('li');
        li.className = test.skipped ? 'is-skip' : (test.passed ? 'is-pass' : 'is-fail');
        li.textContent = test.skipped ? 'N/A ' + test.name + ': ' + test.reason
                                      : (test.passed ? 'PASS ' : 'FAIL ') + test.name + (test.passed ? ' (' + test.assertions + ')' : ': ' + test.error) + ' ' + test.ms + ' ms';
        list.appendChild(li);
    }

    function run() {
        var i = 0;
        (function next() {
            if (i >= queue.length) {
                results.done = true;
                var sum = document.getElementById('exp-test-summary');
                if (sum) {
                    sum.textContent = results.passed + ' passed, ' + results.failed + ' failed' + (results.skipped ? ', ' + results.skipped + ' not applicable here' : '');
                    sum.className = results.failed ? 'is-fail' : 'is-pass';
                }
                return;
            }
            var item = queue[i++], t = new Assert(item.name), start = Date.now();
            var done = function (error) {
                var skipped = error instanceof Skip;
                var test = { name: item.name, passed: !error || skipped, error: error && !skipped ? String(error.message || error) : '', assertions: t.count, ms: Date.now() - start };
                if (skipped) { test.skipped = true; test.reason = error.reason; }
                results.tests.push(test);
                results[skipped ? 'skipped' : (test.passed ? 'passed' : 'failed')]++;
                row(test);
                next();
            };
            var timer = window.setTimeout(function () { done(new Error('timed out after 15 s')); done = function () {}; }, 15000);
            Promise.resolve().then(function () { return item.fn(t); }).then(function () { window.clearTimeout(timer); done(null); },
                                                                         function (e) { window.clearTimeout(timer); done(e); });
        }());
    }

    /**
     * A page without jQuery, for the tests of the plain JavaScript path: a same-origin frame with this page's
     * configuration blocks and form token, then exp/core.js, io.js and datatable.js (and opts.modules: dialog ...)
     * loaded from the addresses on #exp-test-bare (data-core, data-io, ...). Resolves with the frame's window once its
     * Exp is ready; opts.dir: 'rtl'; opts.before(win): called before the scripts load. ExpTest.unbare(win) removes it.
     */
    function bare(opts) {
        opts = opts || {};
        var urls = document.getElementById('exp-test-bare');
        if (!urls) { return Promise.reject(new Skip('N/A: the test page has no #exp-test-bare (the addresses of the scripts)')); }
        var names = ['core', 'io', 'datatable'].concat(opts.modules || []);
        var frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('tabindex', '-1');
        frame.className = 'exp-test-bare';
        frame.style.width = '1000px';
        frame.style.height = '600px';
        document.body.appendChild(frame);
        var win = frame.contentWindow, doc = frame.contentDocument;
        if (opts.dir) { doc.documentElement.setAttribute('dir', opts.dir); }
        Array.prototype.forEach.call(document.querySelectorAll('script[type="application/json"][data-exp-config]'), function (block) {
            doc.head.appendChild(doc.importNode(block, true));
        });
        var token = document.getElementById('ezxform_token_js');
        if (token) { doc.body.appendChild(doc.importNode(token, true)); }
        var sandbox = doc.createElement('div');
        sandbox.id = 'sandbox';
        doc.body.appendChild(sandbox);
        if (opts.before) { opts.before(win); }
        return new Promise(function (resolve, reject) {
            var timer = window.setTimeout(function () { reject(new Error('the frame without jQuery did not start')); }, 10000);
            (function next(i) {
                if (i >= names.length) {
                    if (!win.Exp || !win.Exp.ready) { window.clearTimeout(timer); reject(new Error('no Exp core in the frame')); return; }
                    win.Exp.ready(function () { window.clearTimeout(timer); resolve(win); });
                    return;
                }
                var s = doc.createElement('script');
                s.src = urls.getAttribute('data-' + names[i]);
                s.onload = function () { next(i + 1); };
                s.onerror = function () { window.clearTimeout(timer); reject(new Error('not loaded: ' + s.src)); };
                doc.head.appendChild(s);
            }(0));
        });
    }

    function unbare(win) {
        var frame = win && win.frameElement;
        if (frame && frame.parentNode) { frame.parentNode.removeChild(frame); }
    }

    window.ExpTest = {
        test: function (name, fn) { queue.push({ name: name, fn: fn }); },
        inlineScripts: inlineScripts,
        bare: bare,
        unbare: unbare,
        run: run
    };
}(window, document));
