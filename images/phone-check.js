/*
 * Mobile phone check for the lead forms (IT / ES / GB numbers only).
 * Same rules run in the browser (window.PhoneCheck) and on the brelliozo
 * server (require). Keep in sync with profitsolutions/api/submit-lead.php
 * (check_phone) and vettro/src/lib/phone.ts.
 *
 * PhoneCheck.check(raw, defaultCountry) → { ok, e164, country, reason }
 *   raw            what the visitor typed ("312 345 6789", "+34 612…", "0039…")
 *   defaultCountry 'IT' | 'ES' | 'GB' — used when no international prefix is typed
 *   reason         when !ok: 'letters' | 'country' | 'short' | 'long' | 'landline' | 'invalid'
 */
(function (root) {
  'use strict';

  var DIAL = { IT: '39', ES: '34', GB: '44' };
  var BY_DIAL = { '39': 'IT', '34': 'ES', '44': 'GB' };

  // Italian source messages; pages translate them with I18N.t().
  var MESSAGES = {
    letters: 'Il numero di telefono può contenere solo cifre.',
    country: 'Sono accettati solo numeri italiani (+39), spagnoli (+34) o britannici (+44).',
    short: 'Il numero di telefono è troppo corto.',
    long: 'Il numero di telefono è troppo lungo.',
    landline: 'Sembra un numero fisso: inserisci un numero di cellulare.',
    invalid: 'Inserisci un numero di cellulare valido.'
  };

  function looksFake(n) {
    if (/(\d)\1{6,}/.test(n)) return true; // 3333333
    var up = '0123456789012', down = '9876543210987';
    for (var i = 0; i + 7 <= n.length; i++) {
      var run = n.substr(i, 7);
      if (up.indexOf(run) !== -1 || down.indexOf(run) !== -1) return true; // 1234567
    }
    return false;
  }

  // n = national significant number (digits after the country code).
  function checkNational(country, n) {
    if (country === 'IT') {
      if (/^0/.test(n)) return 'landline';
      if (!/^3/.test(n)) return 'invalid';
      if (n.length < 9) return 'short';
      if (n.length > 10) return 'long';
    } else if (country === 'ES') {
      if (/^[89]/.test(n)) return 'landline';
      if (!/^(6|7[1-9])/.test(n)) return 'invalid';
      if (n.length < 9) return 'short';
      if (n.length > 9) return 'long';
    } else if (country === 'GB') {
      if (/^[123]/.test(n)) return 'landline';
      if (!/^7/.test(n)) return 'invalid';
      if (n.length < 10) return 'short';
      if (n.length > 10) return 'long';
      if (/^76/.test(n) && !/^7624/.test(n)) return 'invalid'; // pagers
      if (/^7700900/.test(n)) return 'invalid'; // Ofcom TV/film range
    }
    return looksFake(n) ? 'invalid' : '';
  }

  function check(raw, defaultCountry) {
    var s = String(raw == null ? '' : raw).trim();
    if (/[A-Za-z]/.test(s)) return fail('letters');
    var plus = /^\+/.test(s);
    var digits = s.replace(/\D/g, '');
    if (!digits) return fail('short');
    if (!plus && /^00/.test(digits)) { plus = true; digits = digits.slice(2); }

    var country, n;
    if (plus) {
      country = BY_DIAL[digits.slice(0, 2)];
      if (!country) return fail('country');
      n = digits.slice(2);
    } else {
      country = DIAL[defaultCountry] ? defaultCountry : 'IT';
      n = digits;
      // "39 312 345 6789" typed without the +
      var cc = DIAL[country];
      if (n.indexOf(cc) === 0 && checkNational(country, n.slice(cc.length)) === '' && checkNational(country, n) !== '') n = n.slice(cc.length);
    }
    if (country === 'GB' && /^0/.test(n)) n = n.slice(1); // 07700 → 7700

    var reason = checkNational(country, n);
    if (reason) return { ok: false, e164: '', country: country, reason: reason };
    return { ok: true, e164: '+' + DIAL[country] + n, country: country, reason: '' };
  }

  function fail(reason) { return { ok: false, e164: '', country: '', reason: reason }; }

  var api = { check: check, MESSAGES: MESSAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhoneCheck = api;
})(this);
