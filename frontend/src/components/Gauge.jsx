import React from 'react';

const Gauge = ({ value, min = 0, max = 100, label, unit, color, subText }) => {
  // Constrain value within boundaries
  const constrainedValue = Math.min(Math.max(value, min), max);
  
  // Calculate percentage
  const percent = ((constrainedValue - min) / (max - min)) * 100;
  
  // SVG Arc configuration (semi-circle pointing upwards)
  // Center is at (50, 58), Radius is 36
  const radius = 36;
  const strokeWidth = 7;
  const circumference = Math.PI * radius; // ~113.1
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  // Format display value
  const displayVal = typeof value === 'number' ? value.toFixed(1) : value;

  return (
    <div className="gauge-wrapper">
      <svg viewBox="0 0 100 66" className="gauge-svg" style={{ overflow: 'visible' }}>
        {/* Glow filter */}
        <defs>
          <filter id={`gauge-glow-${color.replace('#', '')}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer track background */}
        <path
          className="gauge-bg"
          d="M 14 56 A 36 36 0 0 1 86 56"
          strokeWidth={strokeWidth}
        />

        {/* Active progress arc */}
        <path
          className="gauge-value-arc"
          d="M 14 56 A 36 36 0 0 1 86 56"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          filter={`url(#gauge-glow-${color.replace('#', '')})`}
        />

        {/* Live numerical readout embedded inside the SVG to prevent any overlap/drift */}
        <text 
          x="50" 
          y="46" 
          textAnchor="middle" 
          fill={color} 
          fontSize="11.5" 
          fontWeight="bold" 
          style={{ fontFamily: 'var(--font-mono)', transition: 'fill 0.3s ease' }}
        >
          {displayVal}
        </text>

        {/* Unit label embedded inside the SVG */}
        <text 
          x="50" 
          y="54" 
          textAnchor="middle" 
          fill="var(--text-secondary)" 
          fontSize="4" 
          fontWeight="600" 
          letterSpacing="0.05em"
          style={{ fontFamily: 'var(--font-sans)', textTransform: 'uppercase' }}
        >
          {unit}
        </text>
      </svg>
      
      <span className="gauge-label" style={{ marginTop: '0.25rem' }}>{label}</span>
      {subText && <span className="gauge-sub-info">{subText}</span>}
    </div>
  );
};

export default Gauge;
