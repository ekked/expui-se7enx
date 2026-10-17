/**
 * expui/test: starts the Exp API's unit tests (runner.js and the *.test.js files loaded before this file), once the
 * Exp API is ready. A file instead of an inline script, so the test page runs under a Content Security Policy
 * without 'unsafe-inline'.
 */
(function (window) {
    if (!window.ExpTest) { return; }
    if (window.Exp && window.Exp.ready) {
        window.Exp.ready(function () { window.ExpTest.run(); });
    } else {
        window.ExpTest.run();
    }
}(window));
