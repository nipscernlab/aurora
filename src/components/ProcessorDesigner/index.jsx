import React, { useState, useCallback, useRef } from 'react';
import { 
  PlusCircle, 
  Settings, 
  Save, 
  Download, 
  Upload, 
  Cpu, 
  Database,
  Calculator,
  Memory,
  Workflow,
  Share2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

const ProcessorDesigner = () => {
  const [components, setComponents] = useState([]);
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [connections, setConnections] = useState([]);
  const canvasRef = useRef(null);
  const [draggedComponent, setDraggedComponent] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Component templates
  const componentTemplates = [
    {
      type: 'ALU',
      icon: <Calculator className="w-6 h-6" />,
      color: '#FF6B6B',
      config: {
        operations: ['ADD', 'SUB', 'MUL', 'DIV', 'AND', 'OR', 'XOR', 'NOT'],
        bitWidth: 32,
        pipelined: false,
        latency: 1
      }
    },
    {
      type: 'RegisterFile',
      icon: <Database className="w-6 h-6" />,
      color: '#4ECDC4',
      config: {
        numRegisters: 32,
        bitWidth: 32,
        readPorts: 2,
        writePorts: 1
      }
    },
    {
      type: 'Cache',
      icon: <Memory className="w-6 h-6" />,
      color: '#45B7D1',
      config: {
        size: '32KB',
        lineSize: 64,
        associativity: 4,
        writePolicy: 'write-back'
      }
    },
    {
      type: 'ControlUnit',
      icon: <Cpu className="w-6 h-6" />,
      color: '#96CEB4',
      config: {
        pipelineStages: 5,
        branchPrediction: true,
        instructionSet: 'RISC-V'
      }
    },
    {
      type: 'Bus',
      icon: <Share2 className="w-6 h-6" />,
      color: '#D4A5A5',
      config: {
        width: 32,
        protocol: 'AXI4',
        arbitration: 'round-robin'
      }
    }
  ];

  // Handle component drag start
  const handleDragStart = (e, component) => {
    setDraggedComponent(component);
  };

  // Handle component drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    if (!draggedComponent) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newComponent = {
      ...draggedComponent,
      id: `${draggedComponent.type}-${Date.now()}`,
      position: { x, y },
      config: { ...draggedComponent.config }
    };

    setComponents(prev => [...prev, newComponent]);
    setDraggedComponent(null);
  }, [draggedComponent]);

  // Component settings panel
  const ComponentSettings = ({ component }) => {
    if (!component) return null;

    return (
      <Card className="w-80 absolute right-4 top-4 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {component.icon}
            {component.type} Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(component.config).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <label className="text-sm font-medium">{key}</label>
                {typeof value === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => updateComponentConfig(component.id, key, e.target.checked)}
                    className="ml-2"
                  />
                ) : typeof value === 'number' ? (
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => updateComponentConfig(component.id, key, parseInt(e.target.value))}
                    className="w-full p-2 border rounded"
                  />
                ) : Array.isArray(value) ? (
                  <select
                    multiple
                    value={value}
                    onChange={(e) => updateComponentConfig(component.id, key, 
                      Array.from(e.target.selectedOptions, option => option.value))}
                    className="w-full p-2 border rounded"
                  >
                    {value.map(op => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => updateComponentConfig(component.id, key, e.target.value)}
                    className="w-full p-2 border rounded"
                  />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  // Update component configuration
  const updateComponentConfig = (componentId, key, value) => {
    setComponents(prev => prev.map(comp => {
      if (comp.id === componentId) {
        return {
          ...comp,
          config: {
            ...comp.config,
            [key]: value
          }
        };
      }
      return comp;
    }));
  };

  // Canvas rendering
  const renderCanvas = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    // Draw connections
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    connections.forEach(connection => {
      ctx.beginPath();
      ctx.moveTo(connection.start.x, connection.start.y);
      ctx.lineTo(connection.end.x, connection.end.y);
      ctx.stroke();
    });

    // Draw components
    components.forEach(component => {
      ctx.fillStyle = component.color;
      ctx.strokeStyle = selectedComponent?.id === component.id ? '#fff' : '#000';
      ctx.lineWidth = 2;
      
      // Draw component box
      ctx.beginPath();
      ctx.roundRect(component.position.x - 40, component.position.y - 40, 80, 80, 10);
      ctx.fill();
      ctx.stroke();

      // Draw component label
      ctx.fillStyle = '#000';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(component.type, component.position.x, component.position.y + 50);
    });
  };

  // Component palette
  const ComponentPalette = () => (
    <div className="absolute left-4 top-4 space-y-2">
      <Card className="w-48">
        <CardHeader>
          <CardTitle className="text-sm">Components</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {componentTemplates.map((component) => (
              <div
                key={component.type}
                draggable
                onDragStart={(e) => handleDragStart(e, component)}
                className="flex flex-col items-center p-2 border rounded cursor-move hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <div className="w-8 h-8 flex items-center justify-center" style={{ color: component.color }}>
                  {component.icon}
                </div>
                <span className="text-xs mt-1">{component.type}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // Toolbar
  const Toolbar = () => (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2 bg-gray-800 p-2 rounded-lg shadow-lg">
      <button className="p-2 hover:bg-gray-700 rounded" onClick={() => setShowSettings(!showSettings)}>
        <Settings className="w-5 h-5" />
      </button>
      <button className="p-2 hover:bg-gray-700 rounded" onClick={handleSave}>
        <Save className="w-5 h-5" />
      </button>
      <button className="p-2 hover:bg-gray-700 rounded" onClick={handleExport}>
        <Download className="w-5 h-5" />
      </button>
      <button className="p-2 hover:bg-gray-700 rounded" onClick={handleImport}>
        <Upload className="w-5 h-5" />
      </button>
    </div>
  );

  // Save/Export/Import handlers
  const handleSave = () => {
    // Implementation for saving processor design
  };

  const handleExport = () => {
    const designData = {
      components,
      connections,
      metadata: {
        version: '1.0',
        timestamp: new Date().toISOString()
      }
    };
    
    const blob = new Blob([JSON.stringify(designData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'processor-design.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const designData = JSON.parse(event.target.result);
          setComponents(designData.components);
          setConnections(designData.connections);
        } catch (error) {
          console.error('Error importing design:', error);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="w-full h-full relative bg-gray-900">
      <ComponentPalette />
      <Toolbar />
      {selectedComponent && <ComponentSettings component={selectedComponent} />}
      
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="w-full h-full"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={(e) => {
          const rect = canvasRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          
          // Check if clicked on a component
          const clicked = components.find(comp => {
            const dx = comp.position.x - x;
            const dy = comp.position.y - y;
            return Math.sqrt(dx * dx + dy * dy) < 40;
          });
          
          setSelectedComponent(clicked || null);
        }}
      />

      {components.length === 0 && (
        <Alert className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96">
          <AlertDescription>
            Drag and drop components from the palette to start designing your processor.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default ProcessorDesigner;