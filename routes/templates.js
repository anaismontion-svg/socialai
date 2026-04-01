// ================================================================
//  SocialAI — templates.js  (FICHIER PARTAGÉ front + back)
//  30 templates SVG paramétrés
//  Chemin : shared/templates.js  (ou src/shared/templates.js)
//
//  Usage front  : import { renderTemplate } from '../shared/templates'
//  Usage back   : const { renderTemplate } = require('../shared/templates')
// ================================================================

function ck(n, a = '#e8e8e8', b = '#f2f2f2') {
  return `<defs><pattern id="p${n}" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="${a}"/><rect x="5" y="5" width="5" height="5" fill="${a}"/><rect x="5" width="5" height="5" fill="${b}"/><rect y="5" width="5" height="5" fill="${b}"/></pattern></defs>`;
}

const TEMPLATES = {

  T01: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T01')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="62" height="480" fill="${c.primaryColor}"/>
<text transform="translate(31,360) rotate(-90)" font-family="${c.fontTitle||'serif'}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<rect x="30" y="20" width="3" height="40" fill="rgba(255,255,255,0.4)"/>
<rect x="38" y="20" width="3" height="40" fill="rgba(255,255,255,0.2)"/>
<rect x="78" y="26" width="178" height="252" fill="url(#pT01)" rx="2"/>
<rect x="78" y="296" width="178" height="1.5" fill="${c.primaryColor}"/>
<text x="78" y="318" font-family="${c.fontTitle||'serif'}" font-size="15" font-weight="700" fill="${c.secondaryColor}">${c.tagline||'Votre slogan'}</text>
<text x="78" y="337" font-family="${c.fontTitle||'serif'}" font-size="15" font-weight="700" fill="${c.primaryColor}">collection</text>
<text x="78" y="356" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#aaa">${c.website||'www.monsite.fr'}</text>
<rect x="78" y="370" width="100" height="28" fill="${c.primaryColor}" rx="2"/>
<text x="128" y="389" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">DÉCOUVRIR →</text>
</svg>`,

  T02: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T02')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="138" fill="${c.primaryColor}"/>
<text x="135" y="60" font-family="${c.fontTitle||'serif'}" font-size="9" fill="rgba(255,255,255,0.65)" text-anchor="middle" letter-spacing="3">${(c.businessName||'').toUpperCase()}</text>
<text x="135" y="98" font-family="${c.fontTitle||'serif'}" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">Nouveauté</text>
<rect x="38" y="108" width="194" height="230" fill="url(#pT02)" rx="3"/>
<text x="135" y="366" font-family="${c.fontTitle||'serif'}" font-size="11" fill="${c.secondaryColor}" text-anchor="middle" letter-spacing="2">OFFRE SPÉCIALE</text>
<text x="135" y="408" font-family="${c.fontTitle||'serif'}" font-size="40" font-weight="700" fill="${c.primaryColor}" text-anchor="middle">−30%</text>
<text x="135" y="432" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#999" text-anchor="middle">sur toute la collection</text>
<text x="135" y="458" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#bbb" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T03: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T03')}
<rect width="270" height="480" fill="#fff"/>
<text x="135" y="30" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#bbb" text-anchor="middle" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<rect x="12" y="42" width="114" height="188" fill="url(#pT03)" rx="2"/>
<rect x="144" y="42" width="114" height="188" fill="url(#pT03)" rx="2"/>
<rect x="12" y="192" width="60" height="22" fill="${c.primaryColor}"/>
<text x="42" y="207" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#fff" text-anchor="middle">AVANT</text>
<rect x="196" y="192" width="62" height="22" fill="${c.secondaryColor}"/>
<text x="227" y="207" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#fff" text-anchor="middle">APRÈS</text>
<rect x="12" y="248" width="246" height="162" fill="url(#pT03)" rx="2"/>
<rect x="0" y="428" width="270" height="52" fill="${c.primaryColor}"/>
<text x="135" y="450" font-family="${c.fontTitle||'serif'}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="468" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.7)" text-anchor="middle">${c.hashtag||'#monbusiness'}</text>
</svg>`,

  T04: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T04')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="480" fill="${c.primaryColor}" opacity="0.06"/>
<rect x="16" y="16" width="238" height="310" fill="url(#pT04)" rx="3"/>
<rect x="16" y="16" width="238" height="310" fill="none" stroke="${c.primaryColor}" stroke-width="2" rx="3"/>
<rect x="60" y="264" width="150" height="36" fill="${c.primaryColor}"/>
<text x="135" y="287" font-family="${c.fontTitle||'serif'}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<text x="135" y="368" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="${c.secondaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="394" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#999" text-anchor="middle">Découvrez nos services</text>
<rect x="85" y="412" width="100" height="30" fill="${c.secondaryColor}" rx="15"/>
<text x="135" y="431" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">En savoir + →</text>
<text x="135" y="460" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#bbb" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T05: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T05')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="380" width="270" height="100" fill="${c.primaryColor}"/>
<rect x="16" y="16" width="238" height="348" fill="url(#pT05)" rx="2"/>
<rect x="16" y="292" width="238" height="72" fill="${c.secondaryColor}" opacity="0.75"/>
<text x="26" y="324" font-family="${c.fontTitle||'serif'}" font-size="18" font-weight="700" fill="#fff">${c.tagline||'Votre slogan'}</text>
<text x="26" y="348" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.6)" letter-spacing="1">${(c.businessName||'').toUpperCase()} · ${c.website||''}</text>
<text x="135" y="410" font-family="${c.fontTitle||'serif'}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">Swipe up</text>
<text x="135" y="438" font-family="${c.fontBody||'sans-serif'}" font-size="16" fill="#fff" text-anchor="middle">↑</text>
<text x="135" y="460" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.6)" text-anchor="middle">${c.hashtag||'#monbusiness'}</text>
</svg>`,

  T06: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T06','#ccc','#d8d8d8')}
<rect width="270" height="480" fill="${c.secondaryColor}"/>
<rect x="80" y="0" width="190" height="240" fill="${c.primaryColor}"/>
<rect x="0" y="280" width="134" height="120" fill="${c.primaryColor}" opacity="0.28"/>
<rect x="40" y="188" width="54" height="54" fill="${c.accentColor||'#F5EDE3'}"/>
<rect x="16" y="36" width="140" height="178" fill="url(#pT06)" rx="2"/>
<text x="26" y="296" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="#fff">${c.tagline||'Votre slogan'}</text>
<text x="26" y="320" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="${c.primaryColor}">unique</text>
<rect x="26" y="345" width="100" height="28" fill="none" stroke="#fff" stroke-width="1.2" rx="2"/>
<text x="76" y="363" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle">EN SAVOIR +</text>
<text x="26" y="432" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.35)">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T07: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T07','#c8c8c8','#d5d5d5')}
<rect width="270" height="480" fill="${c.accentColor||'#F5EDE3'}"/>
<rect x="0" y="320" width="270" height="160" fill="${c.secondaryColor}"/>
<circle cx="248" cy="60" r="44" fill="${c.primaryColor}" opacity="0.22"/>
<rect x="20" y="54" width="230" height="248" fill="url(#pT07)"/>
<rect x="20" y="54" width="230" height="248" fill="none" stroke="${c.primaryColor}" stroke-width="1.5"/>
<rect x="64" y="256" width="142" height="34" fill="${c.primaryColor}"/>
<text x="135" y="278" font-family="${c.fontTitle||'serif'}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<text x="135" y="340" font-family="${c.fontTitle||'serif'}" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="400" font-family="${c.fontBody||'sans-serif'}" font-size="14" fill="${c.primaryColor}" text-anchor="middle">↑</text>
<text x="135" y="425" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.35)" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T08: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T08')}
<rect width="270" height="480" fill="#fff"/>
<polygon points="0,0 270,0 270,200 0,338" fill="${c.primaryColor}" opacity="0.1"/>
<rect x="0" y="374" width="120" height="106" fill="${c.primaryColor}"/>
<rect x="26" y="26" width="218" height="282" fill="url(#pT08)" rx="3"/>
<rect x="26" y="264" width="120" height="34" fill="${c.secondaryColor}"/>
<text x="36" y="278" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="rgba(255,255,255,0.55)" letter-spacing="2">NOUVEAU</text>
<text x="36" y="291" font-family="${c.fontTitle||'serif'}" font-size="10" font-weight="700" fill="#fff">${c.businessName||'Mon Commerce'}</text>
<text x="26" y="340" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="${c.secondaryColor}">${c.tagline||'Votre slogan'}</text>
<text x="26" y="364" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="${c.primaryColor}">notre univers</text>
<text x="20" y="412" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff">Disponible maintenant</text>
<text x="20" y="430" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.7)">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T09: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T09','#ccc','#ddd')}
<rect width="270" height="480" fill="${c.secondaryColor}"/>
<rect x="0" y="0" width="160" height="270" fill="${c.primaryColor}" opacity="0.18"/>
<rect x="110" y="200" width="160" height="280" fill="${c.primaryColor}" opacity="0.12"/>
<rect x="26" y="26" width="218" height="260" fill="url(#pT09)" rx="3"/>
<rect x="26" y="26" width="218" height="260" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1" rx="3"/>
<text x="135" y="315" font-family="${c.fontTitle||'serif'}" font-size="11" fill="rgba(255,255,255,0.5)" text-anchor="middle" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<text x="135" y="352" font-family="${c.fontTitle||'serif'}" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<rect x="95" y="368" width="80" height="1.5" fill="${c.primaryColor}"/>
<rect x="80" y="420" width="110" height="28" fill="${c.primaryColor}" rx="14"/>
<text x="135" y="438" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">Découvrir →</text>
</svg>`,

  T10: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T10','#ccc','#d8d8d8')}
<rect width="270" height="480" fill="${c.accentColor||'#F5EDE3'}"/>
<rect x="0" y="0" width="270" height="90" fill="${c.secondaryColor}"/>
<rect x="0" y="388" width="270" height="92" fill="${c.secondaryColor}"/>
<text x="135" y="52" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="${c.primaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="72" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.5)" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<rect x="26" y="106" width="218" height="268" fill="url(#pT10)" rx="2"/>
<rect x="26" y="106" width="218" height="268" fill="none" stroke="${c.primaryColor}" stroke-width="2" rx="2"/>
<rect x="74" y="340" width="122" height="16" fill="${c.primaryColor}"/>
<text x="135" y="416" font-family="${c.fontTitle||'serif'}" font-size="13" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<text x="135" y="438" font-family="${c.fontBody||'sans-serif'}" font-size="14" fill="${c.primaryColor}" text-anchor="middle">↑</text>
<text x="135" y="458" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="middle">${(c.website||'').toUpperCase()}</text>
</svg>`,

  T11: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T11')}
<rect width="270" height="480" fill="#fff"/>
<text x="20" y="33" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#999" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<rect x="184" y="20" width="66" height="20" fill="${c.primaryColor}"/>
<text x="217" y="34" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#fff" text-anchor="middle" font-weight="700">${c.hashtag||'#monbusiness'}</text>
<rect x="20" y="46" width="230" height="258" fill="url(#pT11)"/>
<rect x="20" y="46" width="230" height="258" fill="none" stroke="#1a1a1a" stroke-width="1.5"/>
<rect x="0" y="313" width="270" height="167" fill="#1a1a1a"/>
<rect x="20" y="330" width="34" height="3" fill="${c.primaryColor}"/>
<text x="20" y="358" font-family="${c.fontTitle||'serif'}" font-size="19" font-weight="700" fill="#fff">${c.tagline||'Notre actualité'}</text>
<text x="20" y="380" font-family="${c.fontTitle||'serif'}" font-size="19" font-weight="700" fill="#fff">du moment</text>
<rect x="20" y="420" width="86" height="26" fill="${c.primaryColor}"/>
<text x="63" y="437" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">VOIR PLUS →</text>
</svg>`,

  T12: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T12','#ccc','#d5d5d5')}
<rect width="270" height="480" fill="#f5f5f5"/>
<rect x="197" y="0" width="73" height="480" fill="#1a1a1a"/>
<text transform="translate(234,360) rotate(-90)" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="middle" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<rect x="180" y="20" width="90" height="24" fill="${c.primaryColor}"/>
<text x="225" y="36" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#fff" text-anchor="middle" font-weight="700">${c.hashtag||'#monbusiness'}</text>
<rect x="14" y="40" width="170" height="284" fill="url(#pT12)"/>
<rect x="14" y="40" width="170" height="284" fill="none" stroke="#333" stroke-width="1.2"/>
<text x="14" y="354" font-family="${c.fontTitle||'serif'}" font-size="16" font-weight="700" fill="#1a1a1a">${c.tagline||'Votre message'}</text>
<text x="14" y="374" font-family="${c.fontTitle||'serif'}" font-size="16" font-weight="700" fill="${c.primaryColor}">ici</text>
<text x="234" y="446" font-family="${c.fontBody||'sans-serif'}" font-size="16" fill="${c.primaryColor}" text-anchor="middle">↑</text>
</svg>`,

  T13: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T13')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="196" fill="url(#pT13)"/>
<rect x="0" y="136" width="270" height="60" fill="${c.secondaryColor}" opacity="0.62"/>
<text x="20" y="181" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="#fff">${c.tagline||'Notre actualité'}</text>
<rect x="20" y="212" width="37" height="2.5" fill="${c.primaryColor}"/>
<text x="20" y="235" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#888" letter-spacing="2">ARTICLE · ${(c.businessName||'').toUpperCase()}</text>
<text x="20" y="262" font-family="${c.fontTitle||'serif'}" font-size="13" fill="${c.secondaryColor}">Découvrez nos derniers</text>
<text x="20" y="280" font-family="${c.fontTitle||'serif'}" font-size="13" fill="${c.secondaryColor}">conseils et actualités</text>
<rect x="20" y="295" width="103" height="108" fill="url(#pT13)"/>
<rect x="148" y="295" width="102" height="34" fill="${c.primaryColor}"/>
<text x="199" y="316" font-family="${c.fontTitle||'serif'}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">Lire la suite</text>
<rect x="0" y="420" width="270" height="60" fill="${c.secondaryColor}"/>
<text x="135" y="446" font-family="${c.fontTitle||'serif'}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<text x="135" y="464" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="middle">${c.hashtag||'#monbusiness'}</text>
</svg>`,

  T14: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T14')}
<rect width="270" height="480" fill="#111"/>
<rect x="0" y="0" width="270" height="288" fill="url(#pT14)"/>
<rect x="0" y="220" width="270" height="68" fill="${c.primaryColor}"/>
<text x="20" y="254" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="#fff">${c.tagline||'Votre slogan'}</text>
<text x="20" y="274" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.7)" letter-spacing="1">${(c.businessName||'').toUpperCase()}</text>
<rect x="20" y="305" width="44" height="3" fill="${c.primaryColor}"/>
<text x="20" y="340" font-family="${c.fontTitle||'serif'}" font-size="17" fill="#fff">Nouvelle</text>
<text x="20" y="362" font-family="${c.fontTitle||'serif'}" font-size="17" fill="${c.primaryColor}">collection !</text>
<rect x="20" y="416" width="110" height="28" fill="${c.primaryColor}" rx="14"/>
<text x="75" y="434" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">Voir →</text>
<text x="20" y="462" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.25)">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T15: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T15')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="56" fill="${c.secondaryColor}"/>
<text x="135" y="34" font-family="${c.fontTitle||'serif'}" font-size="18" font-weight="700" fill="${c.primaryColor}" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<rect x="20" y="70" width="110" height="148" fill="url(#pT15)" rx="2"/>
<rect x="140" y="70" width="110" height="148" fill="url(#pT15)" rx="2"/>
<rect x="140" y="70" width="110" height="148" fill="none" stroke="${c.primaryColor}" stroke-width="1.5" rx="2"/>
<text x="20" y="265" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="${c.secondaryColor}">${c.tagline||'Votre slogan'}</text>
<rect x="0" y="320" width="270" height="160" fill="${c.primaryColor}"/>
<text x="135" y="370" font-family="${c.fontTitle||'serif'}" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">Tarifs et prestations</text>
<text x="135" y="395" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="rgba(255,255,255,0.7)" text-anchor="middle">À partir de 49€ / séance</text>
<rect x="85" y="412" width="100" height="26" fill="#fff" rx="13"/>
<text x="135" y="429" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="${c.primaryColor}" text-anchor="middle" font-weight="700">Réserver →</text>
<text x="135" y="460" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.5)" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T16: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T16','#cee4e4','#daecec')}
<rect width="270" height="480" fill="${c.primaryColor}"/>
<path d="M0,0 C54,54 -14,134 40,200 C94,266 0,320 26,402 L0,402Z" fill="rgba(0,0,0,0.1)"/>
<rect x="16" y="40" width="238" height="268" fill="#fff" rx="3"/>
<rect x="23" y="47" width="224" height="254" fill="url(#pT16)" rx="2"/>
<rect x="174" y="53" width="66" height="23" fill="${c.secondaryColor}" opacity="0.88"/>
<text x="207" y="68" font-family="${c.fontTitle||'serif'}" font-size="9" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<path d="M0,320 C66,306 204,340 270,320 L270,480 L0,480Z" fill="rgba(255,255,255,0.12)"/>
<text x="135" y="356" font-family="${c.fontTitle||'serif'}" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<rect x="84" y="400" width="102" height="28" fill="none" stroke="#fff" stroke-width="1.2" rx="14"/>
<text x="135" y="419" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle">Swipe up ↑</text>
</svg>`,

  T17: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T17')}
<rect width="270" height="480" fill="${c.secondaryColor}"/>
<path d="M0,134 C80,107 190,161 270,134 L270,360 C190,387 80,334 0,360Z" fill="${c.primaryColor}"/>
<rect x="14" y="148" width="114" height="198" fill="url(#pT17)" rx="2"/>
<rect x="14" y="148" width="114" height="198" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" rx="2"/>
<rect x="142" y="161" width="114" height="198" fill="url(#pT17)" rx="2"/>
<rect x="142" y="161" width="114" height="198" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" rx="2"/>
<text x="135" y="57" font-family="${c.fontTitle||'serif'}" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="78" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.5)" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<text x="135" y="432" font-family="${c.fontBody||'sans-serif'}" font-size="14" fill="#fff" text-anchor="middle">↑</text>
<text x="135" y="454" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.3)" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T18: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T18','#cee4e4','#daecec')}
<rect width="270" height="480" fill="${c.secondaryColor}"/>
<rect x="14" y="14" width="242" height="452" fill="url(#pT18)" rx="3"/>
<rect x="14" y="14" width="242" height="452" fill="none" stroke="${c.primaryColor}" stroke-width="2.5" rx="3"/>
<path d="M14,14 L256,14 L256,67 C200,87 80,54 14,80Z" fill="${c.primaryColor}" opacity="0.82"/>
<rect x="53" y="23" width="164" height="30" fill="${c.secondaryColor}" opacity="0.76"/>
<text x="135" y="43" font-family="${c.fontTitle||'serif'}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<path d="M14,387 C80,374 200,393 256,381 L256,466 L14,466Z" fill="${c.primaryColor}" opacity="0.88"/>
<text x="135" y="416" font-family="${c.fontTitle||'serif'}" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="440" font-family="${c.fontBody||'sans-serif'}" font-size="12" fill="#fff" text-anchor="middle">↑</text>
</svg>`,

  T19: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T19','#d0e8e8','#dceeee')}
<rect width="270" height="480" fill="${c.primaryColor}"/>
<path d="M0,400 Q135,360 270,400 L270,480 L0,480Z" fill="${c.secondaryColor}" opacity="0.9"/>
<path d="M0,0 Q135,50 270,0 L270,80 L0,80Z" fill="${c.secondaryColor}" opacity="0.6"/>
<rect x="20" y="95" width="230" height="292" fill="url(#pT19)" rx="3"/>
<rect x="20" y="95" width="230" height="292" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" rx="3"/>
<text x="135" y="30" font-family="${c.fontTitle||'serif'}" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<text x="135" y="52" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.5)" text-anchor="middle">${c.hashtag||'#monbusiness'}</text>
<text x="135" y="424" font-family="${c.fontTitle||'serif'}" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="448" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.55)" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T20: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T20','#cee4e4','#daecec')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="200" fill="${c.primaryColor}"/>
<path d="M0,180 C90,210 180,170 270,200 L270,240 C180,210 90,250 0,220Z" fill="#fff"/>
<rect x="20" y="30" width="230" height="168" fill="url(#pT20)" rx="2"/>
<rect x="20" y="30" width="230" height="168" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1" rx="2"/>
<text x="135" y="260" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="${c.secondaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<rect x="95" y="272" width="80" height="1.5" fill="${c.primaryColor}"/>
<text x="135" y="304" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#aaa" text-anchor="middle">Découvrez nos services</text>
<rect x="0" y="330" width="270" height="150" fill="url(#pT20)"/>
<rect x="0" y="330" width="270" height="150" fill="none" stroke="${c.primaryColor}" stroke-width="1.5"/>
<rect x="60" y="448" width="150" height="22" fill="${c.primaryColor}"/>
<text x="135" y="463" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#fff" text-anchor="middle" font-weight="700">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T21: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T21','#ccc','#d5d5d5')}
<rect width="270" height="480" fill="#f0f0f0"/>
<rect x="0" y="0" width="73" height="480" fill="${c.primaryColor}"/>
<rect x="73" y="0" width="197" height="54" fill="${c.secondaryColor}"/>
<rect x="73" y="54" width="54" height="54" fill="${c.primaryColor}"/>
<text x="100" y="90" font-family="${c.fontTitle||'serif'}" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">01</text>
<rect x="73" y="108" width="197" height="252" fill="url(#pT21)"/>
<rect x="73" y="360" width="197" height="120" fill="${c.secondaryColor}"/>
<text x="87" y="386" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="rgba(255,255,255,0.45)" letter-spacing="2">STORIES</text>
<text x="87" y="408" font-family="${c.fontTitle||'serif'}" font-size="14" font-weight="700" fill="#fff">${c.tagline||'Votre slogan'}</text>
<text x="87" y="428" font-family="${c.fontTitle||'serif'}" font-size="14" font-weight="700" fill="${c.primaryColor}">percutant</text>
<text x="87" y="448" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="rgba(255,255,255,0.35)">${c.website||'www.monsite.fr'}</text>
<text transform="translate(39,354) rotate(-90)" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#fff" text-anchor="middle" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<rect x="20" y="20" width="2" height="38" fill="rgba(255,255,255,0.45)"/>
<rect x="26" y="20" width="2" height="38" fill="rgba(255,255,255,0.25)"/>
</svg>`,

  T22: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T22')}
<rect width="270" height="480" fill="#fff"/>
<rect x="20" y="20" width="43" height="43" fill="${c.primaryColor}"/>
<text x="41" y="50" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">03</text>
<rect x="134" y="20" width="116" height="2" fill="${c.secondaryColor}"/>
<rect x="134" y="27" width="116" height="2" fill="${c.secondaryColor}"/>
<rect x="134" y="34" width="116" height="2" fill="${c.primaryColor}"/>
<rect x="20" y="77" width="230" height="254" fill="url(#pT22)"/>
<rect x="20" y="345" width="107" height="50" fill="${c.secondaryColor}"/>
<text x="73" y="365" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="rgba(255,255,255,0.5)" text-anchor="middle" letter-spacing="2">STORIES</text>
<text x="73" y="382" font-family="${c.fontTitle||'serif'}" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">TEMPLATE</text>
<text x="140" y="362" font-family="${c.fontTitle||'serif'}" font-size="13" font-weight="700" fill="${c.secondaryColor}">${c.tagline||'Votre slogan'}</text>
<text x="140" y="380" font-family="${c.fontTitle||'serif'}" font-size="13" font-weight="700" fill="${c.primaryColor}">du moment</text>
<rect x="20" y="408" width="230" height="1.5" fill="${c.secondaryColor}"/>
<rect x="20" y="415" width="120" height="1.5" fill="${c.primaryColor}"/>
<text x="20" y="436" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="#888" letter-spacing="1">${(c.businessName||'').toUpperCase()}</text>
<text x="250" y="436" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="${c.primaryColor}" text-anchor="end">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T23: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T23','#ccc','#d5d5d5')}
<rect width="270" height="480" fill="#f2f2f2"/>
<rect x="0" y="0" width="270" height="80" fill="${c.primaryColor}"/>
<rect x="20" y="20" width="43" height="40" fill="${c.secondaryColor}"/>
<text x="41" y="47" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">05</text>
<rect x="20" y="94" width="147" height="250" fill="url(#pT23)"/>
<rect x="180" y="94" width="90" height="120" fill="${c.secondaryColor}"/>
<rect x="180" y="224" width="90" height="120" fill="${c.primaryColor}"/>
<text x="225" y="148" font-family="${c.fontTitle||'serif'}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<rect x="0" y="362" width="270" height="118" fill="${c.secondaryColor}"/>
<text x="20" y="395" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="rgba(255,255,255,0.4)" letter-spacing="2">STORIES TEMPLATE</text>
<text x="20" y="418" font-family="${c.fontTitle||'serif'}" font-size="16" font-weight="700" fill="#fff">${c.tagline||'Votre slogan'}</text>
<text x="20" y="438" font-family="${c.fontTitle||'serif'}" font-size="16" font-weight="700" fill="${c.primaryColor}">percutant</text>
<text x="20" y="458" font-family="${c.fontBody||'sans-serif'}" font-size="8" fill="rgba(255,255,255,0.35)" letter-spacing="1">${(c.website||'').toUpperCase()}</text>
</svg>`,

  T24: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T24','#ccc','#d5d5d5')}
<rect width="270" height="480" fill="#1a1a1a"/>
<rect x="0" y="0" width="270" height="4" fill="${c.primaryColor}"/>
<rect x="0" y="476" width="270" height="4" fill="${c.primaryColor}"/>
<rect x="0" y="0" width="4" height="480" fill="${c.primaryColor}"/>
<rect x="266" y="0" width="4" height="480" fill="${c.primaryColor}"/>
<rect x="20" y="22" width="230" height="260" fill="url(#pT24)"/>
<rect x="20" y="296" width="100" height="30" fill="${c.primaryColor}"/>
<text x="70" y="316" font-family="${c.fontBody||'sans-serif'}" font-size="11" fill="#fff" text-anchor="middle" font-weight="700">${c.hashtag||'#monbusiness'}</text>
<rect x="20" y="340" width="44" height="3" fill="${c.primaryColor}"/>
<text x="20" y="370" font-family="${c.fontTitle||'serif'}" font-size="18" font-weight="700" fill="#fff">${c.tagline||'Votre slogan'}</text>
<text x="20" y="393" font-family="${c.fontTitle||'serif'}" font-size="18" font-weight="700" fill="${c.primaryColor}">— exclusif</text>
<rect x="20" y="444" width="120" height="24" fill="${c.primaryColor}" rx="12"/>
<text x="80" y="460" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#fff" text-anchor="middle" font-weight="700">Voir la collection →</text>
</svg>`,

  T25: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T25','#ccc','#d5d5d5')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="110" fill="${c.secondaryColor}"/>
<rect x="0" y="370" width="270" height="110" fill="${c.secondaryColor}"/>
<text x="135" y="58" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="${c.primaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="84" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.45)" text-anchor="middle" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<rect x="20" y="126" width="230" height="230" fill="url(#pT25)"/>
<rect x="20" y="126" width="230" height="230" fill="none" stroke="${c.primaryColor}" stroke-width="2"/>
<rect x="20" y="304" width="230" height="36" fill="${c.primaryColor}" opacity="0.9"/>
<text x="135" y="328" font-family="${c.fontTitle||'serif'}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">Nouvelle prestation</text>
<text x="135" y="406" font-family="${c.fontTitle||'serif'}" font-size="15" fill="#fff" text-anchor="middle">${c.businessName||'Mon Commerce'}</text>
<text x="135" y="430" font-family="${c.fontBody||'sans-serif'}" font-size="13" fill="${c.primaryColor}" text-anchor="middle">↑ Swipe up</text>
<text x="135" y="454" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.35)" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T26: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T26','#e0e0e0','#eaeaea')}
<rect width="270" height="480" fill="${c.accentColor||'#F5EDE3'}"/>
<circle cx="227" cy="60" r="70" fill="${c.primaryColor}" opacity="0.14"/>
<circle cx="40" cy="380" r="90" fill="${c.secondaryColor}" opacity="0.06"/>
<rect x="30" y="36" width="210" height="270" fill="url(#pT26)" rx="4"/>
<rect x="30" y="36" width="210" height="270" fill="none" stroke="${c.primaryColor}" stroke-width="1" rx="4"/>
<rect x="30" y="36" width="1.5" height="270" fill="${c.primaryColor}"/>
<text x="135" y="334" font-family="${c.fontTitle||'serif'}" font-size="11" fill="${c.primaryColor}" text-anchor="middle" letter-spacing="3">${(c.businessName||'').toUpperCase()}</text>
<text x="135" y="374" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="${c.secondaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<rect x="85" y="418" width="100" height="28" fill="${c.primaryColor}" rx="14"/>
<text x="135" y="436" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">En savoir +</text>
<text x="135" y="465" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#bbb" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T27: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T27','#e0e0e0','#eaeaea')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="186" fill="${c.primaryColor}" opacity="0.1"/>
<rect x="0" y="0" width="6" height="480" fill="${c.primaryColor}"/>
<text x="135" y="46" font-family="${c.fontTitle||'serif'}" font-size="26" font-weight="700" fill="${c.secondaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<rect x="95" y="55" width="80" height="1.5" fill="${c.primaryColor}"/>
<text x="135" y="78" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#aaa" text-anchor="middle" letter-spacing="2">${(c.businessName||'').toUpperCase()}</text>
<rect x="20" y="96" width="230" height="272" fill="url(#pT27)" rx="3"/>
<rect x="60" y="388" width="150" height="26" fill="${c.primaryColor}" rx="13"/>
<text x="135" y="405" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">${c.hashtag||'#monbusiness'}</text>
<text x="135" y="440" font-family="${c.fontBody||'sans-serif'}" font-size="16" fill="${c.primaryColor}" text-anchor="middle">↑</text>
<text x="135" y="462" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#ccc" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T28: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T28','#e0e0e0','#eaeaea')}
<rect width="270" height="480" fill="${c.secondaryColor}"/>
<rect x="12" y="12" width="246" height="456" fill="${c.accentColor||'#F5EDE3'}" rx="3"/>
<circle cx="240" cy="44" r="44" fill="${c.primaryColor}" opacity="0.2"/>
<rect x="28" y="28" width="224" height="280" fill="url(#pT28)" rx="2"/>
<rect x="28" y="276" width="224" height="2" fill="${c.primaryColor}"/>
<text x="135" y="330" font-family="${c.fontTitle||'serif'}" font-size="11" fill="${c.primaryColor}" text-anchor="middle" letter-spacing="3">${(c.businessName||'').toUpperCase()}</text>
<text x="135" y="366" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="${c.secondaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<rect x="80" y="413" width="110" height="28" fill="${c.primaryColor}" rx="14"/>
<text x="135" y="431" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">Prendre RDV →</text>
<text x="135" y="460" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#bbb" text-anchor="middle">${c.website||'www.monsite.fr'}</text>
</svg>`,

  T29: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T29','#e0e0e0','#eaeaea')}
<rect width="270" height="480" fill="#fff"/>
<rect x="0" y="0" width="270" height="50" fill="${c.primaryColor}" opacity="0.1"/>
<rect x="14" y="58" width="242" height="284" fill="url(#pT29)" rx="3"/>
<rect x="14" y="58" width="1.5" height="284" fill="${c.primaryColor}"/>
<rect x="14" y="340" width="242" height="1.5" fill="${c.primaryColor}" opacity="0.3"/>
<text x="135" y="374" font-family="${c.fontTitle||'serif'}" font-size="20" font-weight="700" fill="${c.secondaryColor}" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<text x="135" y="400" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#bbb" text-anchor="middle">Passion · Savoir-faire · Excellence</text>
<rect x="75" y="418" width="120" height="28" fill="none" stroke="${c.primaryColor}" stroke-width="1.5" rx="14"/>
<text x="135" y="436" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="${c.primaryColor}" text-anchor="middle" font-weight="700">Découvrir →</text>
<text x="135" y="465" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="#ccc" text-anchor="middle">${c.hashtag||'#monbusiness'}</text>
</svg>`,

  T30: (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 480">
${ck('T30','#e0e0e0','#eaeaea')}
<rect width="270" height="480" fill="${c.accentColor||'#F5EDE3'}"/>
<rect x="0" y="200" width="270" height="280" fill="${c.secondaryColor}" opacity="0.96"/>
<rect x="30" y="20" width="210" height="210" fill="url(#pT30)" rx="100"/>
<rect x="30" y="20" width="210" height="210" fill="none" stroke="${c.primaryColor}" stroke-width="1.5" rx="100"/>
<text x="135" y="270" font-family="${c.fontTitle||'serif'}" font-size="11" fill="rgba(255,255,255,0.5)" text-anchor="middle" letter-spacing="3">${(c.businessName||'').toUpperCase()}</text>
<rect x="95" y="280" width="80" height="1" fill="${c.primaryColor}" opacity="0.5"/>
<text x="135" y="316" font-family="${c.fontTitle||'serif'}" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">${c.tagline||'Votre slogan'}</text>
<rect x="80" y="368" width="110" height="30" fill="${c.primaryColor}" rx="15"/>
<text x="135" y="387" font-family="${c.fontBody||'sans-serif'}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">Prendre RDV →</text>
<text x="135" y="450" font-family="${c.fontBody||'sans-serif'}" font-size="13" fill="${c.primaryColor}" text-anchor="middle">↑</text>
<text x="135" y="468" font-family="${c.fontBody||'sans-serif'}" font-size="9" fill="rgba(255,255,255,0.3)" text-anchor="middle">${c.hashtag||'#monbusiness'}</text>
</svg>`,
};

// ----------------------------------------------------------------
//  renderTemplate(id, clientVars) → SVG string
//  clientVars = { primaryColor, secondaryColor, accentColor,
//                 fontTitle, fontBody, businessName,
//                 tagline, website, hashtag }
// ----------------------------------------------------------------
function renderTemplate(id, clientVars = {}) {
  const fn = TEMPLATES[id];
  if (!fn) throw new Error(`Template inconnu : ${id}`);
  return fn(clientVars);
}

// Liste de tous les IDs disponibles
const TEMPLATE_IDS = Object.keys(TEMPLATES);

// Export compatible CommonJS ET ES Modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTemplate, TEMPLATE_IDS, TEMPLATES };
} else {
  // ES Module (front)
  // export { renderTemplate, TEMPLATE_IDS, TEMPLATES };
}