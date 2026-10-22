{* expui/test: the Exp API's unit tests on a real admin page. The configuration first, then the scripts in place
   (ezscript, not ezscript_require), as a page that uses the API loads them. *}
{exp_config( hash( 'prefs', array( 'exp_test_pref' ), 'strings', array( 'Exp test %n of %m' ) ) )}
{ezcss( array( 'exp/core.css', 'exp/dialog.css', 'exp/upload.css', 'exp/datatable.css', 'exp/datepicker.css', 'exp/autosave.css' ) )}
<div class="exp-test-fixtures">
    <div id="exp-test-expected" hidden="hidden"
         data-siteaccess="{$expected_siteaccess|wash}"
         data-root="{$expected_root|wash}"
         data-pref="{$test_pref|wash}"
         data-inline-scripts="{$inline_scripts|wash}"
         data-close="{'Close'|i18n( 'extension/expui' )|wash}"></div>
    {* the scripts one by one, for the tests that load them into a frame without jQuery (ExpTest.bare()) *}
    <div id="exp-test-bare" hidden="hidden"
         data-core="{'javascript/exp/core.js'|ezdesign( 'no' )|wash}"
         data-io="{'javascript/exp/io.js'|ezdesign( 'no' )|wash}"
         data-datatable="{'javascript/exp/datatable.js'|ezdesign( 'no' )|wash}"
         data-compat="{'javascript/exp/compat.js'|ezdesign( 'no' )|wash}"
         data-collapse="{'javascript/exp/collapse.js'|ezdesign( 'no' )|wash}"
         data-sticky="{'javascript/exp/sticky.js'|ezdesign( 'no' )|wash}"
         data-dialog="{'javascript/exp/dialog.js'|ezdesign( 'no' )|wash}"
         data-upload="{'javascript/exp/upload.js'|ezdesign( 'no' )|wash}"
         data-datepicker="{'javascript/exp/datepicker.js'|ezdesign( 'no' )|wash}"
         data-autosave="{'javascript/exp/autosave.js'|ezdesign( 'no' )|wash}"></div>
    <input id="exp-test-input" type="text" aria-label="Test field" />
    <div id="exp-test-sandbox"></div>
</div>
{ezscript( array( 'exp::core', 'exp::io', 'exp::compat', 'exp::collapse', 'exp::sticky', 'exp::dialog', 'exp::upload', 'exp::datatable', 'exp::datepicker', 'exp::autosave',
                 'exp/test/runner.js', 'exp/test/core.test.js', 'exp/test/io.test.js', 'exp/test/compat.test.js', 'exp/test/collapse.test.js', 'exp/test/sticky.test.js',
                 'exp/test/dialog.test.js', 'exp/test/upload.test.js', 'exp/test/datatable.test.js', 'exp/test/datepicker.test.js', 'exp/test/autosave.test.js' ) )}

<div class="exp-scope exp-test">
    <h1>Exponential UI tests</h1>
    <p>The unit tests of the Exp API modules, run here on an admin page, next to the admin's own jQuery.</p>
    <p id="exp-test-summary">Running&hellip;</p>
    <ol id="exp-test-results"></ol>

</div>

{* the tests start here, after the results list (exp/test/start.js; no inline script) *}
{ezscript( array( 'exp/test/start.js' ) )}
