import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Power, 
  Zap, 
  Activity, 
  Cpu, 
  Database, 
  List, 
  AlertTriangle,
  Play,
  RotateCcw
} from 'lucide-react';
import Gauge from './components/Gauge';
import LiveCharts from './components/LiveCharts';

const BACKEND_PORTS = [5000, 5001, 5002, 5003];

const getSocketUrls = () => {
  const protocol = window.location.protocol;
  const host = window.location.hostname;
  return BACKEND_PORTS.map((port) => `${protocol}//${host}:${port}`);
};

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [telemetry, setTelemetry] = useState({
    voltage: 0.0,
    current: 0.0,
    frequency: 0.0,
    rpm: 0,
    status: "OFFLINE",
    pwm: 0,
    manual_pwm: 0,
    system_on: false,
    relay_on: false,
    auto_ramp_active: false,
    timestamp: Math.floor(Date.now() / 1000)
  });

  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [sliderValue, setSliderValue] = useState(0);
  
  const socketRef = useRef(null);
  const prevStatesRef = useRef({ system_on: false, relay_on: false });
  const lastLogTimeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let activeSocket = null;
    const socketUrls = getSocketUrls();

    const connectToNextPort = (index = 0) => {
      if (cancelled) return;

      const socket = io(socketUrls[index], {
        reconnection: false,
        timeout: 4000,
        transports: ['websocket', 'polling'],
      });

      activeSocket = socket;
      socketRef.current = socket;

      socket.on('connect', () => {
        if (cancelled) return;
        setIsConnected(true);
        console.log(`Connected to monitoring backend on ${socketUrls[index]}`);
      });

      socket.on('connect_error', () => {
        if (cancelled) return;
        socket.disconnect();
        if (index + 1 < socketUrls.length) {
          connectToNextPort(index + 1);
        } else {
          setIsConnected(false);
          console.warn('Unable to connect to monitoring backend on any fallback port.');
        }
      });

      socket.on('disconnect', () => {
        setIsConnected(false);
        console.log('Disconnected from monitoring backend');
      });

      socket.on('telemetry', (data) => {
        setTelemetry(data);
        
        // Sync local slider input value with database PWM value if not actively changing
        if (data.auto_ramp_active || !data.system_on) {
          setSliderValue(data.pwm);
        } else {
          setSliderValue(data.manual_pwm);
        }

        // Add to rolling history chart data (max 60 points)
        setHistory(prev => {
          const next = [...prev, data];
          if (next.length > 60) next.shift();
          return next;
        });

        // Generation Log Trigger Logic
        const now = Date.now();
        const stateChanged = 
          prevStatesRef.current.system_on !== data.system_on ||
          prevStatesRef.current.relay_on !== data.relay_on;
        
        const timeElapsed = (now - lastLogTimeRef.current) >= 5000; // Log periodically every 5 seconds if system is on

        if (stateChanged || (data.system_on && timeElapsed)) {
          // Calculate power: Power (W) = V * I / 1000 (assuming Current is in mA)
          const powerW = Number(((data.voltage * data.current) / 1000).toFixed(2));
          
          let eventDescription = "Monitoring Feed";
          if (stateChanged) {
            if (prevStatesRef.current.system_on !== data.system_on) {
              eventDescription = data.system_on ? "System Power ON" : "System Power OFF";
            } else if (prevStatesRef.current.relay_on !== data.relay_on) {
              eventDescription = data.relay_on ? "Load Relay CONNECTED" : "Load Relay DISCONNECTED";
            }
          } else {
            eventDescription = "Steady State Generation";
          }

          const newLog = {
            id: `${data.timestamp}-${Math.random()}`,
            timestamp: data.timestamp,
            voltage: data.voltage,
            current: data.current,
            power: powerW,
            system_on: data.system_on,
            relay_on: data.relay_on,
            event: eventDescription
          };

          setLogs(prev => [newLog, ...prev].slice(0, 100)); // Cap logs at 100 entries

          // Update tracking references
          prevStatesRef.current = { system_on: data.system_on, relay_on: data.relay_on };
          lastLogTimeRef.current = now;
        }
      });
    };

    connectToNextPort();

    return () => {
      cancelled = true;
      activeSocket?.disconnect();
    };
  }, []);

  // UI Commands
  const toggleSystem = () => {
    if (!socketRef.current) return;
    socketRef.current.emit('control', {
      command: 'system_on',
      value: !telemetry.system_on
    });
  };

  const toggleRelay = () => {
    if (!socketRef.current) return;
    socketRef.current.emit('control', {
      command: 'relay_on',
      value: !telemetry.relay_on
    });
  };

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setSliderValue(val);
  };

  const handleSliderRelease = () => {
    if (!socketRef.current) return;
    socketRef.current.emit('control', {
      command: 'manual_pwm',
      value: sliderValue
    });
  };

  // Derived Values
  const powerWatts = ((telemetry.voltage * telemetry.current) / 1000).toFixed(2);
  
  // LED Alert status (voltage thresholds <180V or >250V)
  // Driven purely by comparing live voltage value against fixed thresholds
  const isOverVoltage = telemetry.voltage > 220;
  const isUnderVoltage = telemetry.system_on && telemetry.voltage < 180; // only alert under-voltage if system is powered

  return (
    <div className="dashboard-container">
      {/* 1. Header */}
      <header className="dashboard-header">
        <h1>Pico Hydropower Monitoring</h1>
        <div className="dashboard-subtitle">
          <span>Simulation & Lab-Scale Telemetry Console</span>
          <div className={`connection-pill ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className={`connection-dot ${isConnected ? 'pulse' : ''}`}></span>
            <span>{isConnected ? 'LIVE FEED' : 'OFFLINE'}</span>
          </div>
          {telemetry.status === "OK" && !isConnected && (
            <div className="connection-pill sim-mode-indicator">
              <span>SIMULATOR ACTIVE</span>
            </div>
          )}
        </div>
      </header>

      {/* 2. Controls & Overrides Grid */}
      <div className="top-controls-grid">
        {/* Buttons Control Card */}
        <div className="dashboard-card">
          <h3 className="dashboard-card-title">
            <Power size={18} /> Master System Control
          </h3>
          <div className="btn-grid">
            <button 
              className={`control-btn system-btn ${telemetry.system_on ? 'active' : ''}`}
              onClick={toggleSystem}
              title="Toggle Turbine System ON/OFF"
            >
              <Power size={24} />
              <span>System {telemetry.system_on ? 'ON' : 'OFF'}</span>
              <span className="btn-status-label">
                {telemetry.auto_ramp_active ? 'Soft Start Ramp' : (telemetry.system_on ? 'Active' : 'Standby')}
              </span>
            </button>

            <button 
              className={`control-btn relay-btn ${telemetry.relay_on ? 'active' : ''}`}
              onClick={toggleRelay}
              title="Toggle Load Relay"
            >
              <Zap size={24} />
              <span>Relay {telemetry.relay_on ? 'ON' : 'OFF'}</span>
              <span className="btn-status-label">
                {telemetry.relay_on ? 'Connected' : 'Disconnected'}
              </span>
            </button>
          </div>
        </div>

        {/* Manual Speed Override Card */}
        <div className="dashboard-card">
          <h3 className="dashboard-card-title">
            <Cpu size={18} /> Manual Speed Override
          </h3>
          <div className="slider-container">
            <div className="slider-header">
              <span className="indicator-label">Motor Duty Cycle (PWM %)</span>
              <span className="slider-value">{sliderValue}%</span>
            </div>
            
            <div className="slider-input-wrapper">
              <input
                type="range"
                min="0"
                max="100"
                value={sliderValue}
                onChange={handleSliderChange}
                onMouseUp={handleSliderRelease}
                onTouchEnd={handleSliderRelease}
                disabled={telemetry.auto_ramp_active || !telemetry.system_on}
                className="slider-input"
              />
            </div>
            
            {telemetry.auto_ramp_active && (
              <span className="slider-hint active">
                ⚠️ Soft-start ramp active (10s lock). Override disabled.
              </span>
            )}
            {!telemetry.system_on && !telemetry.auto_ramp_active && (
              <span className="slider-hint">
                Turn System ON to enable speed control.
              </span>
            )}
            {telemetry.system_on && !telemetry.auto_ramp_active && (
              <span className="slider-hint">
                Manual control active. Drag slider to change turbine speed.
              </span>
            )}
          </div>
        </div>

        {/* Status Indicators (LED Grid) */}
        <div className="dashboard-card">
          <h3 className="dashboard-card-title">
            <AlertTriangle size={18} /> Voltage Safety Indicators
          </h3>
          <div className="indicators-flex">
            <div className="indicator-item">
              <div className={`indicator-light ${isOverVoltage ? 'red' : 'green'}`} />
              <span className="indicator-label">Over-Voltage (&gt;220V)</span>
            </div>
            <div className="indicator-item">
              <div className={`indicator-light ${isUnderVoltage ? 'red' : 'green'}`} />
              <span className="indicator-label">Under-Voltage (&lt;180V)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Live Gauges Row */}
      <div className="gauges-grid">
        <div className="dashboard-card">
          <Gauge 
            value={telemetry.voltage} 
            min={0} 
            max={220} 
            label="Generator Voltage" 
            unit="Volts AC" 
            color="#06b6d4" 
            subText="Target: 200-220V"
          />
        </div>
        <div className="dashboard-card">
          <Gauge 
            value={telemetry.current} 
            min={0} 
            max={1500} 
            label="Load Current" 
            unit="mA" 
            color="#f97316" 
            subText="Limit: 1200mA (ACS712)"
          />
        </div>
        <div className="dashboard-card">
          <Gauge 
            value={telemetry.frequency} 
            min={0} 
            max={75} 
            label="Grid Frequency" 
            unit="Hz" 
            color="#10b981" 
            subText="Target: 50.0Hz"
          />
        </div>
        <div className="dashboard-card">
          <Gauge 
            value={telemetry.rpm} 
            min={0} 
            max={4500} 
            label="Turbine Speed" 
            unit="RPM" 
            color="#f59e0b" 
            subText={`Calculated Power: ${powerWatts}W`}
          />
        </div>
      </div>

      {/* 4. Real-Time Graphs */}
      <LiveCharts historyData={history} />

      {/* 5. Generation Log / Monitor Panel */}
      <div className="dashboard-card log-card">
        <h3 className="dashboard-card-title">
          <List size={18} /> Telemetry & Generation History Logs
        </h3>
        <div className="log-table-container">
          <table className="log-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Description</th>
                <th>Voltage</th>
                <th>Current</th>
                <th>Power Output</th>
                <th>System</th>
                <th>Load</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No logs recorded yet. Turn System ON to begin logging.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id}>
                    <td>{new Date(log.timestamp * 1000).toLocaleTimeString()}</td>
                    <td style={{ color: log.event.includes('ON') || log.event.includes('CONNECTED') ? 'var(--color-success)' : 'inherit' }}>
                      {log.event}
                    </td>
                    <td>{log.voltage} V</td>
                    <td>{log.current} mA</td>
                    <td style={{ color: log.power > 0 ? 'var(--accent-voltage)' : 'inherit', fontWeight: 'bold' }}>
                      {log.power} W
                    </td>
                    <td>
                      <span className={`state-badge ${log.system_on ? 'on' : 'off'}`}>
                        {log.system_on ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td>
                      <span className={`state-badge ${log.relay_on ? 'on' : 'off'}`}>
                        {log.relay_on ? 'ON' : 'OFF'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default App;
