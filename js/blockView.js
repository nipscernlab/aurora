import React, { useState } from 'react';

const HardwareSchematic = () => {
  const [processorData, setProcessorData] = useState({
    NUBITS: 32,
    NBMANT: 24,
    NBEXPO: 8,
    NUIOIN: 8,
    NUIOOU: 8,
    SDEPTH: 256
  });

  // Wire connection points
  const renderWire = (startX, startY, endX, endY) => (
    <line
      x1={startX}
      y1={startY}
      x2={endX}
      y2={endY}
      stroke="black"
      strokeWidth="2"
    />
  );

  // Component for input/output pins
  const Pin = ({ x, y, label, direction = 'right' }) => (
    <g>
      <circle cx={x} cy={y} r="4" fill="black" />
      <text
        x={direction === 'right' ? x + 10 : x - 10}
        y={y + 4}
        textAnchor={direction === 'right' ? 'start' : 'end'}
        className="text-sm"
      >
        {label}
      </text>
    </g>
  );

  return (
    <div className="w-full h-full p-4">
      <svg viewBox="0 0 800 600" className="w-full h-full border border-gray-300">
        {/* ALU Block */}
        <g transform="translate(300, 200)">
          <path
            d="M0,0 L100,50 L100,150 L0,200 L0,0"
            fill="none"
            stroke="black"
            strokeWidth="2"
          />
          <text x="30" y="100" className="text-lg font-bold">ALU</text>
          <text x="20" y="120" className="text-sm">{`${processorData.NUBITS} bits`}</text>
        </g>

        {/* Memory Block */}
        <g transform="translate(500, 200)">
          <rect
            width="120"
            height="160"
            fill="none"
            stroke="black"
            strokeWidth="2"
          />
          <text x="30" y="40" className="text-lg font-bold">Memory</text>
          <text x="20" y="60" className="text-sm">{`Depth: ${processorData.SDEPTH}`}</text>
        </g>

        {/* Control Unit */}
        <g transform="translate(300, 50)">
          <rect
            width="160"
            height="80"
            fill="none"
            stroke="black"
            strokeWidth="2"
          />
          <text x="30" y="45" className="text-lg font-bold">Control Unit</text>
        </g>

        {/* Input Ports */}
        <g transform="translate(100, 150)">
          {Array.from({ length: 4 }).map((_, i) => (
            <Pin
              key={`input-${i}`}
              x={50}
              y={40 * i}
              label={`IN${i}`}
              direction="right"
            />
          ))}
          <text x="0" y="20" className="text-sm font-bold">{`${processorData.NUIOIN} Input Ports`}</text>
        </g>

        {/* Output Ports */}
        <g transform="translate(650, 150)">
          {Array.from({ length: 4 }).map((_, i) => (
            <Pin
              key={`output-${i}`}
              x={50}
              y={40 * i}
              label={`OUT${i}`}
              direction="left"
            />
          ))}
          <text x="0" y="20" className="text-sm font-bold">{`${processorData.NUIOOU} Output Ports`}</text>
        </g>

        {/* Floating Point Unit */}
        <g transform="translate(300, 400)">
          <rect
            width="160"
            height="80"
            fill="none"
            stroke="black"
            strokeWidth="2"
          />
          <text x="20" y="35" className="text-lg font-bold">FPU</text>
          <text x="20" y="55" className="text-sm">{`Mantissa: ${processorData.NBMANT}`}</text>
          <text x="20" y="70" className="text-sm">{`Exponent: ${processorData.NBEXPO}`}</text>
        </g>

        {/* Connections */}
        {/* ALU to Memory */}
        {renderWire(400, 275, 500, 275)}
        {/* Control to ALU */}
        {renderWire(380, 130, 380, 200)}
        {/* Input to ALU */}
        {renderWire(150, 170, 300, 250)}
        {/* ALU to Output */}
        {renderWire(400, 250, 650, 170)}
        {/* ALU to FPU */}
        {renderWire(380, 350, 380, 400)}
      </svg>
    </div>
  );
};

export default HardwareSchematic;