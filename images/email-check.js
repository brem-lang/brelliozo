/*
 * Email check for the lead forms. Same rules run in the browser
 * (window.EmailCheck) and on the brelliozo server (require). Keep in sync
 * with profitsolutions/api/email-check.php and vettro/src/lib/email.ts.
 *
 * EmailCheck.check(raw) → { ok, email, reason, suggestion }
 *   email       trimmed + lowercased address (when ok)
 *   reason      when !ok: 'format' | 'typo' | 'disposable' | 'fake'
 *   suggestion  for 'typo': the corrected address ("mario@gmail.com")
 * The server additionally checks the domain can receive mail ('domain').
 */
(function (root) {
  'use strict';

  // Italian source messages; pages translate them with I18N.t().
  // 'typo' contains {email}, replaced with the suggested address.
  var MESSAGES = {
    format: 'Inserisci un indirizzo e-mail valido.',
    typo: 'Intendevi {email}?',
    disposable: 'Gli indirizzi e-mail temporanei non sono accettati: usa la tua e-mail personale.',
    fake: 'Inserisci il tuo vero indirizzo e-mail.',
    domain: "Questo dominio e-mail non esiste: controlla l'indirizzo."
  };

  // Common providers for IT / ES / GB visitors: typos are matched against these.
  var KNOWN = [
    'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'hotmail.es', 'hotmail.co.uk',
    'outlook.com', 'outlook.it', 'outlook.es', 'live.com', 'live.it', 'live.co.uk', 'msn.com',
    'yahoo.com', 'yahoo.it', 'yahoo.es', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
    'libero.it', 'virgilio.it', 'alice.it', 'tim.it', 'tin.it', 'tiscali.it', 'fastwebnet.it', 'email.it',
    'inwind.it', 'iol.it', 'aruba.it', 'pec.it', 'legalmail.it', 'gmx.com', 'gmx.es', 'gmx.it', 'aol.com',
    'protonmail.com', 'proton.me', 'telefonica.net', 'movistar.es', 'btinternet.com', 'sky.com',
    'virginmedia.com', 'talktalk.net', 'ntlworld.com', 'mail.com', 'email.com', 'gmail.it', 'hotmail.fr',
    'outlook.fr', 'live.fr', 'yahoo.fr', 'orange.fr', 'free.fr', 'web.de', 'gmx.de', 'gmx.net', 'zoho.com',
    'yandex.com', 'mail.ru', 'tutanota.com', 'tuta.io', 'hey.com', 'fastmail.com', 'outlook.co.uk', 'blueyonder.co.uk',
    'virgin.net', 'plus.net', 'aol.co.uk', 'terra.es', 'ono.com', 'jazztel.es', 'vodafone.it', 'vodafone.es'
  ];
  var TLD_TYPOS = {
    con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com', coom: 'com', cpm: 'com', clm: 'com', om: 'com',
    iy: 'it', ti: 'it', itt: 'it', ir: 'it',
    ess: 'es', se: 'es',
    'co.ik': 'co.uk', 'co.uj': 'co.uk', 'co.ul': 'co.uk', 'co.ukk': 'co.uk', 'couk': 'co.uk'
  };
  var DISPOSABLE = [
    'mailinator.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net', 'guerrillamail.com', 'guerrillamail.net',
    'guerrillamail.org', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la', 'pokemail.net', 'spam4.me',
    '10minutemail.com', '10minutemail.net', '10minutemail.co.uk', '20minutemail.com', 'temp-mail.org',
    'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmailo.com', 'tempail.com', 'tempr.email',
    'emailondeck.com', 'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'mytrashmail.com',
    'getnada.com', 'nada.email', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com', 'dispostable.com',
    'fakeinbox.com', 'fakemail.net', 'mailcatch.com', 'mailpoof.com', 'moakt.com', 'mvrht.com', 'dropmail.me',
    'spambox.us', 'spamgourmet.com', 'jetable.org', 'discard.email', 'discardmail.com', 'getairmail.com',
    'burnermail.io', 'inboxkitten.com', 'emailfake.com', 'fake-mail.net', 'tmail.ws', 'tmpmail.org', 'tmpmail.net',
    'luxusmail.org', 'mail.tm', 'mailtemp.net', '1secmail.com', '1secmail.org', '1secmail.net', 'harakirimail.com',
    'mailforspam.com', 'spamfree24.org', 'trash-mail.com', 'wegwerfmail.de', 'einrot.com', 'crazymailing.com',
    'mailsac.com', 'tempinbox.com', 'emailtemporanea.net', 'emailtemporanea.com', 'mailtemporanea.com',
    'correotemporal.org', 'guerrillamail.info', 'mailnull.com', 'trbvm.com', 'kurzepost.de', 'byom.de',
    'tempmailaddress.com', 'boun.cr', 'mailinator.net', 'mailinator2.com', 'notmailinator.com', 'tempmail.plus'
  ];
  var FAKE_DOMAINS = [
    'test.com', 'test.it', 'test.es', 'test.co.uk', 'example.com', 'example.org', 'example.net', 'example.it',
    'example.es', 'domain.com', 'dominio.it', 'dominio.com', 'prova.it', 'prova.com', 'fake.com', 'nomail.com',
    'noemail.com', 'nessuna.it', 'asd.com', 'asdf.com', 'qwerty.com', 'abc.com', 'xxx.com', 'aaa.com'
  ];
  var MASH = /^(?:asd|asdf|asdasd|qwe|qwerty|zxc|zxcv|aaa+|xxx+|abc|test|prova|fake|nome|name)\d*$/;

  function distance(a, b) { // Damerau-Levenshtein (optimal string alignment)
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 0; j <= b.length; j++) { d[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  function suggestDomain(domain) {
    if (KNOWN.indexOf(domain) !== -1) return '';
    var best = '', bestD = 99;
    for (var k = 0; k < KNOWN.length; k++) {
      var dd = distance(domain, KNOWN[k]);
      if (dd < bestD) { bestD = dd; best = KNOWN[k]; }
    }
    if (bestD === 1 && domain.length >= 6) return best;
    if (bestD === 2 && domain.length >= 9) return best;
    // Ending typo on any domain: mario@libero.iy → libero.it
    for (var bad in TLD_TYPOS) {
      if (domain.slice(-(bad.length + 1)) === '.' + bad) {
        var fixed = domain.slice(0, -bad.length) + TLD_TYPOS[bad];
        return KNOWN.indexOf(fixed) !== -1 ? fixed : (suggestDomain(fixed) || fixed);
      }
    }
    return '';
  }

  function check(raw) {
    var email = String(raw == null ? '' : raw).trim().toLowerCase();
    var at = email.lastIndexOf('@');
    if (email.length > 254 || at < 1 || email.indexOf('@') !== at) return fail('format');
    var local = email.slice(0, at), domain = email.slice(at + 1);
    if (local.length > 64 || !/^[a-z0-9._%+'-]+$/.test(local) || /^\.|\.$|\.\./.test(local)) return fail('format');
    var labels = domain.split('.');
    if (labels.length < 2) return fail('format');
    for (var i = 0; i < labels.length; i++) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) return fail('format');
    }
    if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return fail('format');

    if (DISPOSABLE.indexOf(domain) !== -1) return fail('disposable');
    if (FAKE_DOMAINS.indexOf(domain) !== -1 || (MASH.test(local) && MASH.test(labels[0]))) return fail('fake');
    var fix = suggestDomain(domain);
    if (fix) return { ok: false, email: '', reason: 'typo', suggestion: local + '@' + fix };
    return { ok: true, email: email, reason: '', suggestion: '' };
  }

  function fail(reason) { return { ok: false, email: '', reason: reason, suggestion: '' }; }

  // Browser only: show "Intendevi <button>mario@gmail.com</button>?" in el,
  // translated with t(); clicking the address calls onPick(suggestion).
  function renderSuggestion(el, t, suggestion, onPick) {
    var parts = t(MESSAGES.typo).split('{email}');
    el.textContent = '';
    el.appendChild(document.createTextNode(parts[0] || ''));
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = suggestion;
    b.style.cssText = 'background:none;border:0;padding:0;font:inherit;color:inherit;font-weight:700;text-decoration:underline;cursor:pointer';
    b.addEventListener('click', function () { onPick(suggestion); });
    el.appendChild(b);
    el.appendChild(document.createTextNode(parts[1] || ''));
  }

  var api = { check: check, MESSAGES: MESSAGES, renderSuggestion: renderSuggestion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EmailCheck = api;
})(this);
