<?php
/**
 * The browser test page (expui/test) under a Content Security Policy: the three tests that need inline scripts (a
 * dialog with scripts: true, the classic date templates' onclick calendar icon, opened by click and by keyboard)
 * report "N/A under enforced CSP" where the page's policy blocks inline scripts, and still run where it allows them.
 * Checked on the files: the view's flag, the template's attribute, the runner's skip and the tests that use it.
 */

use PHPUnit\Framework\TestCase;

final class TestPageContentSecurityPolicyTest extends TestCase
{
    private function read( $relative )
    {
        $path = EXPUI_TEST_CHECKOUT . '/' . $relative;
        $this->assertFileExists( $path );
        return (string)file_get_contents( $path );
    }

    public function testTheViewTellsThePageWhetherInlineScriptsRun()
    {
        $view = $this->read( 'classes/runnable/views/expui/test.php' );
        $this->assertStringContainsString( "class_exists( 'expContentSecurityPolicy' )", $view, 'works on a kernel without the class' );
        $this->assertStringContainsString( '\expContentSecurityPolicy::allowsInlineScripts()', $view );
        $this->assertStringContainsString( "setVariable( 'inline_scripts'", $view );
        $this->assertStringContainsString( 'data-inline-scripts="{$inline_scripts|wash}"', $this->read( 'design/standard/templates/expui/test.tpl' ) );
    }

    public function testTheRunnerReportsASkippedTestApartFromPassedAndFailed()
    {
        $runner = $this->read( 'design/standard/javascript/exp/test/runner.js' );
        $this->assertStringContainsString( 'skipped: 0', $runner, 'window.ExpTestResults counts the skipped tests' );
        $this->assertStringContainsString( 'Assert.prototype.skip', $runner );
        $this->assertStringContainsString( 'Assert.prototype.needsInlineScripts', $runner );
        $this->assertStringContainsString( "'N/A under enforced CSP: '", $runner );
        $this->assertStringContainsString( "getAttribute('data-inline-scripts')", $runner, 'the server\'s answer first' );
        $this->assertStringContainsString( "probe.setAttribute('onclick'", $runner, 'a probe without it' );
        $this->assertStringContainsString( 'inlineScripts: inlineScripts', $runner );
        $this->assertStringContainsString( ".is-skip", $this->read( 'design/standard/stylesheets/exp/core.css' ) );
    }

    public function testTheTestsThatNeedInlineScriptsSayItAndNoOtherDoes()
    {
        $dialog = $this->read( 'design/standard/javascript/exp/test/dialog.test.js' );
        $datepicker = $this->read( 'design/standard/javascript/exp/test/datepicker.test.js' );
        $this->assertSame( 1, substr_count( $dialog, 't.needsInlineScripts(' ), 'scripts: true only' );
        $this->assertSame( 2, substr_count( $datepicker, 't.needsInlineScripts(' ), 'the onclick icon: click and keyboard' );
        // "not run by default" is a test of its own, which runs under every policy
        $this->assertMatchesRegularExpression( "/test\\('dialog: scripts in HTML content are not run by default', function \\(t\\) \\{\\n(?!\\s*t\\.needsInlineScripts)/", $dialog );
        foreach ( glob( EXPUI_TEST_CHECKOUT . '/design/standard/javascript/exp/test/*.test.js' ) as $file )
        {
            if ( !in_array( basename( $file ), array( 'dialog.test.js', 'datepicker.test.js' ), true ) )
                $this->assertStringNotContainsString( 'needsInlineScripts', (string)file_get_contents( $file ), basename( $file ) );
        }
    }
}
