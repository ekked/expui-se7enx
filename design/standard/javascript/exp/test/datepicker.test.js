/*!
 * Exponential UI (expui) — browser tests of exp::datepicker (Exp.datepicker, $.fn.expDatePicker, showDatePicker).
 * GNU General Public License v2.0 (or any later version). https://github.com/se7enxweb/expui
 */
(function (window, document) {
    'use strict';
    var Exp = window.Exp, test = window.ExpTest.test, $ = Exp.$;

    // the fields as the date/time templates name them: <base>_<datatype>_<part>_<id>
    function fields(withTime) {
        var host = document.getElementById('exp-test-sandbox');
        host.innerHTML = '<input name="T_datetime_year_9" value=""><input name="T_datetime_month_9" value="">'
            + '<input name="T_datetime_day_9" value="">'
            + (withTime ? '<input name="T_datetime_hour_9" value=""><input name="T_datetime_minute_9" value="">' : '')
            + '<img class="datepicker-icon" id="T_datetime_cal_9" alt="" onclick="showDatePicker( \'T\', \'9\', \'datetime\' );">'
            + '<div id="T_datetime_cal_container_9" style="display: none; position: absolute;"></div>';
        return host;
    }
    function wait(ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); }
    function val(part) { return document.getElementsByName('T_datetime_' + part + '_9')[0].value; }
    function picker() { return document.querySelector('#T_datetime_cal_container_9 .exp-datepicker'); }
    function day(n) {
        return Array.prototype.filter.call(document.querySelectorAll('.exp-datepicker-day:not(.is-other-month)'), function (b) { return b.textContent === String(n); })[0];
    }
    function key(el, k, extra) {
        el.dispatchEvent(new KeyboardEvent('keydown', $.extend({ key: k, bubbles: true, cancelable: true }, extra || {})));
    }

    test('datepicker: showDatePicker() opens the calendar in the template\'s container', function (t) {
        t.needsInlineScripts('the classic date templates\' calendar icon (onclick="showDatePicker(...)")');
        fields(true);
        t.ok(window.showDatePicker && window.showDatePicker.exp, 'showDatePicker is Exponential UI\'s');
        document.getElementById('T_datetime_cal_9').click();
        t.ok(picker(), 'a calendar in the container');
        t.equal(document.getElementById('T_datetime_cal_container_9').style.display, 'block', 'the container is shown');
        t.equal(picker().querySelectorAll('tbody button').length, 42, 'six weeks of days');
        t.equal(picker().querySelectorAll('thead th').length, 7, 'seven weekday names');
        t.ok(Exp.datepicker.isOpen());
        Exp.datepicker.close();
        t.equal(Exp.datepicker.isOpen(), false);
        t.equal(document.getElementById('T_datetime_cal_container_9').style.display, 'none', 'hidden again');
    });

    test('datepicker: choosing a day fills the fields as ezdatepicker.js did, with 12:00 for an empty time', function (t) {
        fields(true);
        window.showDatePicker('T', '9', 'datetime');
        var now = new Date();
        day(15).click();
        t.equal(val('year'), String(now.getFullYear()));
        t.equal(val('month'), String(now.getMonth() + 1), 'the month without a leading zero');
        t.equal(val('day'), '15');
        t.equal(val('hour'), '12', 'an empty hour becomes 12');
        t.equal(val('minute'), '00', 'an empty minute becomes 00');
        t.equal(Exp.datepicker.isOpen(), false, 'closed');
        t.equal(document.activeElement, document.getElementsByName('T_datetime_year_9')[0], 'the year field has the focus');
    });

    test('datepicker: a time already set is kept; a date field without time works', function (t) {
        fields(true);
        document.getElementsByName('T_datetime_hour_9')[0].value = '9';
        document.getElementsByName('T_datetime_minute_9')[0].value = '5';
        window.showDatePicker('T', '9', 'datetime');
        day(3).click();
        t.equal(val('hour'), '9');
        t.equal(val('minute'), '5');
        fields(false);
        window.showDatePicker('T', '9', 'datetime');
        day(4).click();
        t.equal(val('day'), '4', 'date only');
    });

    test('datepicker: opens on the date the fields hold, marked as selected', function (t) {
        fields(true);
        document.getElementsByName('T_datetime_year_9')[0].value = '2024';
        document.getElementsByName('T_datetime_month_9')[0].value = '2';
        document.getElementsByName('T_datetime_day_9')[0].value = '29';
        window.showDatePicker('T', '9', 'datetime');
        var sel = picker().querySelector('.is-selected');
        t.ok(sel, 'a selected day');
        t.equal(sel.getAttribute('data-date'), '2024-02-29');
        t.equal(document.activeElement, sel, 'the selected day has the focus');
        t.ok(/2024/.test(picker().querySelector('.exp-datepicker-title').textContent), 'the title names the year');
        Exp.datepicker.close();
    });

    test('datepicker: previous and next month, and no dates before 1970 (the minimum date)', function (t) {
        fields(true);
        document.getElementsByName('T_datetime_year_9')[0].value = '1970';
        document.getElementsByName('T_datetime_month_9')[0].value = '1';
        document.getElementsByName('T_datetime_day_9')[0].value = '10';
        window.showDatePicker('T', '9', 'datetime');
        t.ok(picker().querySelector('.exp-datepicker-prev').disabled, 'no month before January 1970');
        t.ok(picker().querySelector('button[data-date="1969-12-31"]').disabled, 'a 1969 day cannot be chosen');
        picker().querySelector('.exp-datepicker-next').click();
        t.ok(picker().querySelector('button[data-date="1970-02-01"]:not(.is-other-month)'), 'February 1970');
        picker().querySelector('.exp-datepicker-prev').click();
        t.ok(picker().querySelector('button[data-date="1970-01-31"]:not(.is-other-month)'), 'back to January');
        Exp.datepicker.close();
    });

    test('datepicker: the keyboard moves, chooses and closes', function (t) {
        fields(true);
        document.getElementsByName('T_datetime_year_9')[0].value = '2025';
        document.getElementsByName('T_datetime_month_9')[0].value = '1';
        document.getElementsByName('T_datetime_day_9')[0].value = '31';
        window.showDatePicker('T', '9', 'datetime');
        key(document.activeElement, 'ArrowRight');
        t.equal(document.activeElement.getAttribute('data-date'), '2025-02-01', 'right: the next day, into the next month');
        key(document.activeElement, 'ArrowUp');
        t.equal(document.activeElement.getAttribute('data-date'), '2025-01-25', 'up: a week back');
        key(document.activeElement, 'PageDown');
        t.equal(document.activeElement.getAttribute('data-date'), '2025-02-25', 'Page Down: a month on');
        key(document.activeElement, 'Enter');
        t.equal(val('month'), '2');
        t.equal(val('day'), '25');
        t.equal(Exp.datepicker.isOpen(), false, 'Enter chose and closed');
        window.showDatePicker('T', '9', 'datetime');
        key(document.activeElement, 'Escape');
        t.equal(Exp.datepicker.isOpen(), false, 'Escape closes');
        t.equal(document.activeElement, document.getElementById('T_datetime_cal_9'), 'and gives the focus back to the icon');
    });

    test('datepicker: the week starts on the siteaccess\'s first day', function (t) {
        fields(true);
        Exp.datepicker.open({ fields: { year: '[name=T_datetime_year_9]', month: '[name=T_datetime_month_9]', day: '[name=T_datetime_day_9]' },
                              container: '#T_datetime_cal_container_9', firstDay: 1 });
        var monday = new Date(2025, 0, 6);
        t.equal(picker().querySelector('thead th').getAttribute('abbr'),
                new Intl.DateTimeFormat(Exp.config.locale.http || 'en-GB', { weekday: 'long' }).format(monday), 'Monday first');
        Exp.datepicker.open({ fields: { year: '[name=T_datetime_year_9]', month: '[name=T_datetime_month_9]', day: '[name=T_datetime_day_9]' },
                              container: '#T_datetime_cal_container_9', firstDay: 0 });
        t.equal(picker().querySelector('thead th').getAttribute('abbr'),
                new Intl.DateTimeFormat(Exp.config.locale.http || 'en-GB', { weekday: 'long' }).format(new Date(2025, 0, 5)), 'Sunday first');
        Exp.datepicker.close();
    });

    test('datepicker: a click outside closes it', function (t) {
        fields(true);
        window.showDatePicker('T', '9', 'datetime');
        return new Promise(function (r) { window.setTimeout(r, 20); }).then(function () {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            t.equal(Exp.datepicker.isOpen(), false);
        });
    });

    test('datepicker: $.fn.expDatePicker adds a button and fills its fields', function (t) {
        var host = document.getElementById('exp-test-sandbox');
        host.innerHTML = '<fieldset id="dp"><input class="y"><input class="m"><input class="d"></fieldset>';
        $('#dp').expDatePicker({ fields: { year: '.y', month: '.m', day: '.d' } });
        var button = host.querySelector('.exp-datepicker-button');
        t.ok(button, 'a button after the day field');
        t.equal(button.getAttribute('aria-label'), Exp.i18n('Choose a date'));
        button.click();
        day(20).click();
        t.equal(host.querySelector('.d').value, '20');
        t.equal(host.querySelector('.y').value, String(new Date().getFullYear()));
    });

    test('datepicker: the calendar icon is reachable with the keyboard', function (t) {
        t.needsInlineScripts('the classic date templates\' calendar icon (onclick="showDatePicker(...)")');
        fields(true);
        var icon = document.getElementById('T_datetime_cal_9');
        $(icon).attr({ tabindex: '0', role: 'button' });
        key(icon, 'Enter');
        t.ok(Exp.datepicker.isOpen(), 'Enter on the icon opens it');
        Exp.datepicker.close();
    });

    // ---- without jQuery (exp::core::shared on a page that loads none) ------------------------------------------

    test('datepicker: without jQuery: create() adds the button; the keyboard chooses, the fields get a change event', function (t) {
        var w;
        return window.ExpTest.bare({ modules: ['datepicker'] }).then(function (win) {
            w = win;
            var X = w.Exp, d = w.document, host = d.getElementById('sandbox'), changed = [], events = [];
            t.equal(w.jQuery, undefined, 'no jQuery in the frame');
            host.innerHTML = '<fieldset id="dp"><input class="y" name="y" value="2025"><input class="m" name="m" value="1"><input class="d" name="d" value="31">'
                + '<input class="h" name="h" value=""><input class="i" name="i" value=""></fieldset>';
            host.addEventListener('change', function (e) { changed.push(e.target.name + '=' + e.target.value); });
            ['open', 'select', 'close'].forEach(function (n) { X.on('exp:datepicker:' + n, function (e, data) { events.push(n + ':' + (data.fields.year === host.querySelector('.y'))); }); });
            var set = X.datepicker.create(d.getElementById('dp'), { fields: { year: '.y', month: '.m', day: '.d', hour: '.h', minute: '.i' } });
            t.ok(set && set.button && set.button.classList.contains('exp-datepicker-button'), 'a button after the day field');
            t.equal(set.button.previousElementSibling, host.querySelector('.d'));
            t.equal(set.fields.year, host.querySelector('.y'), 'the fields as elements');
            t.equal(X.datepicker.get('#dp'), set, 'Exp.datepicker.get()');
            set.button.click();
            t.ok(X.datepicker.isOpen(), 'open');
            t.equal(d.activeElement.getAttribute('data-date'), '2025-01-31', 'the date of the fields has the focus');
            d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
            t.equal(d.activeElement.getAttribute('data-date'), '2025-02-01', 'right: into the next month');
            d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            t.equal(X.datepicker.isOpen(), false, 'Enter chose and closed');
            t.deepEqual(changed, ['y=2025', 'm=2', 'd=1', 'h=12', 'i=00'], 'each field got its value and a change event');
            t.equal(d.activeElement, host.querySelector('.y'), 'the year field has the focus');
            t.deepEqual(events, ['open:true', 'close:true', 'select:true'], 'the events hand over the elements');
            set.button.click();
            d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            t.equal(X.datepicker.isOpen(), false, 'Escape closes');
            t.equal(d.activeElement, set.button, 'and gives the focus back');
        }).finally(function () { window.ExpTest.unbare(w); });
    });

    test('datepicker: without jQuery, showDatePicker() opens in the template\'s container; a click outside closes it', function (t) {
        var w;
        return window.ExpTest.bare({ modules: ['datepicker'] }).then(function (win) {
            w = win;
            var d = w.document;
            d.getElementById('sandbox').innerHTML = '<input name="T_date_year_4" value=""><input name="T_date_month_4" value=""><input name="T_date_day_4" value="">'
                + '<button type="button" id="T_date_cal_4">c</button><div id="T_date_cal_container_4" style="display: none"></div>';
            t.ok(w.showDatePicker.exp, 'showDatePicker is Exponential UI\'s');
            var p = w.showDatePicker('T', '4', 'date');
            var box = d.getElementById('T_date_cal_container_4');
            t.ok(p && box.querySelector('.exp-datepicker') === p.element, 'in the container');
            t.equal(box.style.display, 'block', 'the container is shown');
            t.equal(p.element.querySelectorAll('tbody button').length, 42, 'six weeks of days');
            return wait(20).then(function () {
                d.body.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
                t.equal(w.Exp.datepicker.isOpen(), false, 'closed by a click outside');
                t.equal(box.style.display, 'none', 'the container hidden again');
            });
        }).finally(function () { window.ExpTest.unbare(w); });
    });
}(window, document));
