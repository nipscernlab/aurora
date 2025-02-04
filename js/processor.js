import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { 
  Plus, 
  Minus, 
  Cpu, 
  Calculator, 
  Database, 
  ArrowLeftRight,
  Memory,
  Clock,
  Settings,
  Save
} from 'lucide-react';

const ProcessorBuilder = () => {
  const [components, setComponents] = useState({
    alu: {
      operations: ['ADD', 'SUB', 'MUL', 'DIV', 'AND', 'OR', 'XOR', 'NOT'],
      bitWidth: 32,
      pipelined: false,
      position: { x: 300, y: 200 }
    },
    dataStack: {
      size: 1024,
      position: { x: 500, y: 200 }
    },
    instructionStack: {
      size: 512,
      position: { x: 100, y: 200 }
    },
    controlUnit: {
      instructions: [],
      position: { x: 300, y: 50 }
    },
    ports: {
      inputs: [],
      outputs: [],
      position: { x: 300, y: 350 }
    }
  });

  const [connections, setConnections] = useState([]);
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [clockSpeed, setClockSpeed] = useState(100); // MHz

  // SVG Canvas dimensions
  const canvasWidth = 800;
  const canvasHeight = 600;

  // Component visualization constants
  const componentSize = { width: 120, height: 80 };

  const drawComponent = (type, position, isSelected) => {
    const style = {
      fill: isSelected ? 'var(--accent-color)' : 'var(--background-darker)',
      stroke: isSelected ? 'var(--accent-color-hover)' : 'var(--border-color)',
      strokeWidth: isSelected ? 2 : 1,
      cursor: 'pointer'
    };

    return (
      <g transform={`translate(${position.x},${position.y})`}>
        <rect
          x={-componentSize.width/2}
          y={-componentSize.height/2}
          width={componentSize.width}
          height={componentSize.height}
          rx="8"
          {...style}
        />
        <text
          x="0"
          y="0"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text-color)"
          fontSize="14"
        >
          {type}
        </text>
        {/* Add connection points */}
        <circle cx={-componentSize.width/2} cy="0" r="4" fill="var(--accent-color)" />
        <circle cx={componentSize.width/2} cy="0" r="4" fill="var(--accent-color)" />
      </g>
    );
  };

  const drawConnections = () => {
    return connections.map((conn, idx) => (
      <path
        key={idx}
        d={`M ${conn.start.x} ${conn.start.y} L ${conn.end.x} ${conn.end.y}`}
        stroke="var(--accent-color)"
        strokeWidth="2"
        fill="none"
      />
    ));
  };

  const handleDragStart = (component) => {
    setSelectedComponent(component);
    setIsDragging(true);
  };

  const handleDragMove = useCallback((e) => {
    if (!isDragging || !selectedComponent) return;

    const svgRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svgRect.left;
    const y = e.clientY - svgRect.top;

    setComponents(prev => ({
      ...prev,
      [selectedComponent]: {
        ...prev[selectedComponent],
        position: { x, y }
      }
    }));
  }, [isDragging, selectedComponent]);

  const handleDragEnd = () => {
    setIsDragging(false);
    setSelectedComponent(null);
  };

  return (
    <div className="w-full h-full flex">
      <div className="flex-1 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-5 h-5" />
              Processor Visual Builder
            </CardTitle>
          </CardHeader>
          <CardContent>
            <svg
              width={canvasWidth}
              height={canvasHeight}
              className="border border-border rounded-lg"
              onMouseMove={handleDragMove}
              onMouseUp={handleDragEnd}
            >
              {/* Draw grid background */}
              <defs>
                <pattern
                  id="grid"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 20 0 L 0 0 0 20"
                    fill="none"
                    stroke="var(--border-color)"
                    strokeWidth="0.5"
                  />
                </pattern>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="url(#grid)"
              />
              
              {/* Draw components */}
              {Object.entries(components).map(([type, data]) => (
                drawComponent(
                  type,
                  data.position,
                  selectedComponent === type
                )
              ))}
              
              {/* Draw connections */}
              {drawConnections()}
            </svg>
          </CardContent>
        </Card>
      </div>

      <div className="w-80 border-l border-border p-4">
        <Tabs defaultValue="components">
          <TabsList className="w-full">
            <TabsTrigger value="components">Components</TabsTrigger>
            <TabsTrigger value="properties">Properties</TabsTrigger>
          </TabsList>

          <TabsContent value="components" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Available Components</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleDragStart('alu')}
                >
                  <Calculator className="w-4 h-4 mr-2" />
                  Arithmetic Logic Unit
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleDragStart('dataStack')}
                >
                  <Database className="w-4 h-4 mr-2" />
                  Data Stack
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleDragStart('instructionStack')}
                >
                  <Memory className="w-4 h-4 mr-2" />
                  Instruction Stack
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleDragStart('controlUnit')}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Control Unit
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleDragStart('ports')}
                >
                  <ArrowLeftRight className="w-4 h-4 mr-2" />
                  I/O Ports
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">System Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Clock Speed: {clockSpeed} MHz</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setClockSpeed(prev => Math.max(1, prev - 10))}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setClockSpeed(prev => prev + 10)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="properties">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Component Properties</CardTitle>
              </CardHeader>
              <CardContent>
                {selectedComponent ? (
                  <div className="space-y-4">
                    <h3 className="font-medium">{selectedComponent}</h3>
                    {/* Add component-specific properties here */}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a component to view its properties
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-4">
          <Button className="w-full" onClick={() => console.log('Saving processor configuration...')}>
            <Save className="w-4 h-4 mr-2" />
            Save Processor
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProcessorBuilder;