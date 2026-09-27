// The butterfly print on the menu: one red blot, folded, and its mirror image on the other half.

import { splat } from './blots.js';

const SEED = 404;

export function drawLogo(host, seed = SEED) {
  const s = splat(seed);
  const wing = `<path d="${s.body}"/>${s.drops.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}`;
  const small = splat(88);
  // Put the crease just inside the blot's right-hand edge, so the two halves join.
  const reach = (s.right - 2).toFixed(1);
  host.innerHTML = `
  <svg viewBox="0 0 300 206" role="img" aria-label="">
    <defs>
      <filter id="logo-dry" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="3" result="low"/>
        <feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="1" seed="9" result="g"/>
        <feDisplacementMap in="SourceGraphic" in2="g" scale="3" xChannelSelector="R" yChannelSelector="G" result="r"/>
        <feColorMatrix in="low" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -.6 1.2" result="s"/>
        <feComposite in="r" in2="s" operator="in"/>
      </filter>
      <filter id="logo-shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#2a1a0a" flood-opacity=".25"/>
      </filter>
      <filter id="logo-soft"><feGaussianBlur stdDeviation="1.1"/></filter>
    </defs>
    <g transform="rotate(-3 150 103)">
      <rect x="18" y="14" width="264" height="178" rx="3" fill="var(--paper)" filter="url(#logo-shadow)"/>
      <line x1="148.4" y1="14" x2="148.4" y2="192" stroke="rgba(90,70,45,.3)" stroke-width="1.6"/>
      <line x1="151.2" y1="14" x2="151.2" y2="192" stroke="rgba(255,255,255,.85)" stroke-width="1.4"/>
      <g transform="translate(150 103) scale(-1.3 1.3) translate(-${reach} -${s.cy.toFixed(1)})" filter="url(#logo-dry)">
        <g fill="var(--red)" opacity=".9">${wing}</g>
      </g>
      <g transform="translate(150 103) scale(1.3) translate(-${reach} -${s.cy.toFixed(1)})">
        <g fill="var(--red-wet)">${wing}<path d="${s.body}" fill="none" stroke="#7e1a0e" stroke-width="3" opacity=".5"/></g>
        <path d="${s.shine}" pathLength="100" stroke-dasharray="17 83" stroke-dashoffset="-52" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55" filter="url(#logo-soft)"/>
      </g>
      <g transform="translate(228 146) scale(.34)" fill="var(--blue-wet)">
        <path d="${small.body}"/>
      </g>
    </g>
  </svg>`;
}
