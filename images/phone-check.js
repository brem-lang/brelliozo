/*
 * Mobile phone check for the lead forms (IT / ES / GB / DE / SA numbers only).
 * Same rules run in the browser (window.PhoneCheck) and on the brelliozo
 * server (require). Keep in sync with profitsolutions/api/submit-lead.php
 * (check_phone) and vettro/src/lib/phone.ts.
 *
 * PhoneCheck.check(raw, defaultCountry) → { ok, e164, country, reason }
 *   raw            what the visitor typed ("312 345 6789", "+34 612…", "0039…")
 *   defaultCountry 'IT' | 'ES' | 'GB' | 'DE' | 'SA' — used when no international prefix is typed
 *   reason         when !ok: 'letters' | 'country' | 'short' | 'long' | 'landline' | 'invalid'
 */
(function (root) {
  'use strict';

  var DIAL = { IT: '39', ES: '34', GB: '44', DE: '49', SA: '966' };

  // Country whose dial code starts the digits (codes are 2 or 3 digits long).
  function countryFromDial(digits) {
    for (var c in DIAL) if (digits.indexOf(DIAL[c]) === 0) return c;
    return '';
  }

  // Italian source messages; pages translate them with I18N.t().
  var MESSAGES = {
    letters: 'Il numero di telefono può contenere solo cifre.',
    country: 'Sono accettati solo numeri italiani (+39), spagnoli (+34), britannici (+44), tedeschi (+49) o sauditi (+966).',
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
    } else if (country === 'DE') {
      // Mobiles are 15x / 16x / 17x; everything else starting 1–9 is a landline.
      if (!/^1[5-7]/.test(n)) return /^[1-9]/.test(n) ? 'landline' : 'invalid';
      if (n.length < 10) return 'short';
      if (n.length > 11) return 'long';
    } else if (country === 'SA') {
      // Mobiles are 5x xxx xxxx; area codes 1x, 4x, 6x, 7x are landlines.
      if (!/^5/.test(n)) return /^[1467]/.test(n) ? 'landline' : 'invalid';
      if (n.length < 9) return 'short';
      if (n.length > 9) return 'long';
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
      country = countryFromDial(digits);
      if (!country) return fail('country');
      n = digits.slice(DIAL[country].length);
    } else {
      country = DIAL[defaultCountry] ? defaultCountry : 'IT';
      n = digits;
      // "39 312 345 6789" typed without the +
      var cc = DIAL[country];
      if (n.indexOf(cc) === 0 && checkNational(country, n.slice(cc.length)) === '' && checkNational(country, n) !== '') n = n.slice(cc.length);
    }
    // Trunk prefix: 07700 → 7700 (GB), 0151 → 151 (DE), 050 → 50 (SA).
    if ((country === 'GB' || country === 'DE' || country === 'SA') && /^0/.test(n)) n = n.slice(1);

    var reason = checkNational(country, n);
    if (reason) return { ok: false, e164: '', country: country, reason: reason };
    return { ok: true, e164: '+' + DIAL[country] + n, country: country, reason: '' };
  }

  function fail(reason) { return { ok: false, e164: '', country: '', reason: reason }; }

  var api = { check: check, MESSAGES: MESSAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhoneCheck = api;
})(this);
