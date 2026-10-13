/**
 * The moving backdrop behind the sign-up copy: jets crossing the sky with a contrail, the Lagos skyline with the
 * cable-stayed bridge, a danfo and an okada on the bridge, a boat on the lagoon, and a beach corner where people are
 * chilling under an umbrella with music playing. Pure SVG and CSS, so it costs nothing on a phone, and it holds still
 * for anyone who prefers reduced motion.
 */
export function LandingScene() {
  const towers = [
    [40, 70], [62, 110], [80, 86], [104, 150], [128, 96], [146, 128], [170, 80], [500, 120], [524, 170], [548, 104], [574, 140], [600, 92], [626, 118], [652, 76],
  ] as const;
  return (
    <div className="landing-scene" aria-hidden="true">
      <div className="landing-sun" />
      <svg className="landing-jet" viewBox="0 0 120 40">
        <path d="M4 22 L70 18 L92 4 L100 4 L88 19 L112 18 Q118 20 112 22 L88 23 L100 36 L92 36 L70 24 L4 24 Z" fill="#f4efe2" />
        <rect x="76" y="20" width="10" height="1.6" fill="#1f6f5b" />
      </svg>
      <svg className="landing-jet far" viewBox="0 0 120 40">
        <path d="M4 22 L70 18 L92 4 L100 4 L88 19 L112 18 Q118 20 112 22 L88 23 L100 36 L92 36 L70 24 L4 24 Z" fill="#d8e3de" />
      </svg>
      <svg className="landing-city" viewBox="0 0 720 220" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="landing-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#14514a" />
            <stop offset="1" stopColor="#082522" />
          </linearGradient>
        </defs>
        {towers.map(([x, h], index) => (
          <g key={x}>
            <rect x={x} y={170 - h} width={index % 3 === 0 ? 20 : 16} height={h} fill={index % 2 ? "#0f3a35" : "#123f3a"} />
            {Array.from({ length: Math.floor(h / 18) }, (_, row) => (
              <rect key={row} className={`landing-window w${(index + row) % 4}`} x={x + 4} y={176 - h + row * 18} width={index % 3 === 0 ? 12 : 8} height={4} />
            ))}
          </g>
        ))}
        {/* Lekki–Ikoyi link bridge: one pylon with its fan of cables. */}
        <rect x="320" y="60" width="8" height="112" fill="#d9d2bd" />
        {[-150, -110, -70, -35, 35, 70, 110, 150].map((dx) => (
          <line key={dx} x1="324" y1="64" x2={324 + dx} y2="150" stroke="#cfc8b2" strokeWidth="1.2" />
        ))}
        <rect x="140" y="150" width="380" height="7" rx="2" fill="#d9d2bd" />
        <g className="landing-danfo">
          <rect x="0" y="-15" width="30" height="13" rx="3" fill="#f2b705" />
          <rect x="0" y="-9" width="30" height="2.4" fill="#151515" />
          <rect x="3" y="-13" width="6" height="4" fill="#9ad0d8" />
          <rect x="11" y="-13" width="6" height="4" fill="#9ad0d8" />
          <rect x="19" y="-13" width="6" height="4" fill="#9ad0d8" />
          <circle cx="7" cy="-1.5" r="2.6" fill="#151515" />
          <circle cx="23" cy="-1.5" r="2.6" fill="#151515" />
        </g>
        <g className="landing-okada">
          <circle cx="2" cy="-2" r="2.2" fill="#151515" />
          <circle cx="12" cy="-2" r="2.2" fill="#151515" />
          <path d="M2 -2 L7 -6 L12 -2" stroke="#c0392b" strokeWidth="2" fill="none" />
          <circle cx="7" cy="-11" r="2" fill="#4f2d1b" />
          <path d="M7 -9 L6 -5" stroke="#1f6fb2" strokeWidth="2.4" />
        </g>
        <rect x="0" y="170" width="720" height="50" fill="url(#landing-water)" />
        {[0, 1, 2].map((wave) => (
          <path key={wave} className={`landing-wave v${wave}`} d={`M0 ${180 + wave * 12} Q 30 ${176 + wave * 12} 60 ${180 + wave * 12} T 120 ${180 + wave * 12} T 180 ${180 + wave * 12} T 240 ${180 + wave * 12} T 300 ${180 + wave * 12} T 360 ${180 + wave * 12} T 420 ${180 + wave * 12} T 480 ${180 + wave * 12} T 540 ${180 + wave * 12} T 600 ${180 + wave * 12} T 660 ${180 + wave * 12} T 720 ${180 + wave * 12} T 780 ${180 + wave * 12}`} />
        ))}
        <g className="landing-boat">
          <path d="M0 0 L36 0 L30 7 L5 7 Z" fill="#f4efe2" />
          <rect x="10" y="-6" width="14" height="6" rx="1.5" fill="#e7bd62" />
          <path d="M-4 5 Q -14 6 -26 4" stroke="#cfe6e0" strokeWidth="1.2" fill="none" opacity=".7" />
        </g>
      </svg>
      <svg className="landing-chill" viewBox="0 0 220 160">
        <path d="M0 150 Q 110 128 220 150 L220 160 L0 160 Z" fill="#e3c98f" />
        <g className="landing-palm">
          <path d="M168 150 Q 162 100 172 52" stroke="#6b4a2f" strokeWidth="6" fill="none" />
          {[-60, -25, 10, 45, 80, 120].map((angle) => (
            <path key={angle} d="M172 52 Q 196 44 214 60" stroke="#2f7d3c" strokeWidth="5" fill="none" strokeLinecap="round" transform={`rotate(${angle} 172 52)`} />
          ))}
        </g>
        <path d="M58 140 L58 82" stroke="#5a4636" strokeWidth="2.4" />
        <path className="landing-umbrella" d="M20 86 Q 58 52 96 86 Z" fill="#c2185b" />
        <path d="M20 86 Q 39 78 58 86 Q 77 78 96 86" fill="none" stroke="#f3c969" strokeWidth="2" />
        <path d="M26 138 L52 130 L66 138" stroke="#f4efe2" strokeWidth="4" fill="none" />
        <path d="M66 140 L92 132 L106 140" stroke="#f4efe2" strokeWidth="4" fill="none" />
        <g className="landing-lounger">
          <circle cx="46" cy="124" r="5" fill="#4f2d1b" />
          <path d="M40 130 L54 128" stroke="#1f6fb2" strokeWidth="5" strokeLinecap="round" />
        </g>
        <g className="landing-lounger two">
          <circle cx="86" cy="126" r="5" fill="#82502f" />
          <path d="M80 132 L94 130" stroke="#f2b705" strokeWidth="5" strokeLinecap="round" />
          <path className="landing-drink" d="M98 120 L102 120 L101 128 L99 128 Z" fill="#e67e22" />
        </g>
        <rect x="118" y="124" width="12" height="16" rx="2" fill="#17171a" />
        <circle cx="124" cy="130" r="3.5" fill="#3a3a40" />
        {[0, 1, 2].map((note) => (
          <text key={note} className={`landing-note n${note}`} x="124" y="118" fill="#e7bd62" fontSize="12">♪</text>
        ))}
      </svg>
    </div>
  );
}
