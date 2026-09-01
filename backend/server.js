const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onValue, set, update } = require('firebase/database');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Firebase configuration placeholder
// The user can edit this file directly or set these environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "YOUR_API_KEY_HERE",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN_HERE",
  databaseURL: process.env.FIREBASE_DATABASE_URL || "YOUR_DATABASE_URL_HERE",
  projectId: process.env.FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID_HERE",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID_HERE",
  appId: process.env.FIREBASE_APP_ID || "YOUR_APP_ID_HERE"
};

let db = null;
let useSimulator = true;

// Check if firebase config has been configured with real credentials
const isFirebaseConfigured = () => {
  return firebaseConfig.databaseURL && 
         !firebaseConfig.databaseURL.includes("YOUR_DATABASE_URL_HERE") &&
         firebaseConfig.apiKey && 
         !firebaseConfig.apiKey.includes("YOUR_API_KEY_HERE");
};

// Local cache of system state (synced with Firebase or managed by simulator)
let systemState = {
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
};

// Simulation State & Loop Variables
let simulatorInterval = null;
let rampTimer = null;

const startSimulator = () => {
  if (simulatorInterval) return;
  console.log("⚡ Starting Pico Hydropower Simulator Mode...");
  
  simulatorInterval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    systemState.timestamp = now;

    if (!systemState.system_on) {
      // System is OFF: everything decay/rests at 0
      systemState.pwm = 0;
      systemState.auto_ramp_active = false;
      systemState.rpm = Math.max(0, systemState.rpm - 300);
      systemState.frequency = systemState.rpm / 60;
      systemState.voltage = Math.max(0, systemState.voltage - 15);
      systemState.current = Math.max(0, systemState.current - 20);
      systemState.status = "OFFLINE";
    } else {
      // System is ON
      systemState.status = "OK";
      
      // Calculate physics based on current PWM
      const targetRPM = systemState.pwm * 40; // Max 4000 RPM at 100% PWM
      const rpmNoise = (Math.random() - 0.5) * 15;
      systemState.rpm = Math.round(systemState.rpm + (targetRPM - systemState.rpm) * 0.25 + rpmNoise);
      if (systemState.rpm < 0) systemState.rpm = 0;

      // Frequency = RPM / 60
      systemState.frequency = Number((systemState.rpm / 60).toFixed(1));

      // Voltage proportional to frequency (e.g. V = Freq * 4.2)
      const voltageNoise = (Math.random() - 0.5) * 2;
      systemState.voltage = Number((systemState.frequency * 4.25 + voltageNoise).toFixed(1));
      if (systemState.voltage < 0) systemState.voltage = 0;

      // Current drawn only if Relay is ON (load connected)
      if (systemState.relay_on) {
        // I = V / R (let's say load is 1000 ohms, so current is scaled, or dynamic load)
        const loadResistance = 0.85; // Ohm scale
        const currentNoise = (Math.random() - 0.5) * 10;
        systemState.current = Number(((systemState.voltage / loadResistance) + currentNoise).toFixed(1));
      } else {
        // Open circuit: residual tiny current (idle noise)
        systemState.current = Number((Math.random() * 8 + 2).toFixed(1));
      }
    }

    // Broadcast updated state to all connected socket clients
    io.emit('telemetry', systemState);
  }, 1000); // 1-second ticks for simulator reactivity
};

const runSimulationRamp = () => {
  if (rampTimer) clearInterval(rampTimer);
  systemState.auto_ramp_active = true;
  systemState.pwm = 0;
  console.log("🔄 Soft-start Auto Ramp Initiated: 0% -> 70% PWM");

  let elapsed = 0;
  rampTimer = setInterval(() => {
    elapsed += 0.5; // ticks every 500ms
    if (elapsed >= 10) {
      clearInterval(rampTimer);
      systemState.pwm = 70;
      systemState.manual_pwm = 70;
      systemState.auto_ramp_active = false;
      console.log("✅ Soft-start Auto Ramp Completed. Manual override enabled.");
    } else {
      // linear ramp from 0 to 70 over 10 seconds
      systemState.pwm = Math.round((elapsed / 10) * 70);
    }
    io.emit('telemetry', systemState);
  }, 500);
};

// Initialize Firebase if configured
if (isFirebaseConfigured()) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    useSimulator = false;
    console.log("🔥 Connected to Firebase Realtime Database!");

    // Listen to database reference
    const dbRef = ref(db, '/');
    onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Sync local cache with Firebase database updates
        systemState = { ...systemState, ...data };
        io.emit('telemetry', systemState);
      }
    });
  } catch (error) {
    console.error("❌ Firebase initialization failed. Falling back to simulator mode.", error);
    useSimulator = true;
  }
} else {
  console.log("⚠️ Firebase not configured. Running in simulator mode by default.");
  useSimulator = true;
}

if (useSimulator) {
  startSimulator();
}

// REST endpoints for explicit commands (useful as fallback)
app.get('/api/status', (req, res) => {
  res.json(systemState);
});

app.post('/api/control', async (req, res) => {
  const { command, value } = req.body;
  console.log(`✉️ Received Control HTTP API: ${command} = ${value}`);

  try {
    if (useSimulator) {
      handleSimulatorCommand(command, value);
    } else {
      await writeToFirebase(command, value);
    }
    res.json({ success: true, state: systemState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/telemetry', async (req, res) => {
  const telemetryUpdate = req.body;
  console.log('📥 Received telemetry payload from ESP32:', telemetryUpdate);

  try {
    if (useSimulator) {
      const allowedKeys = [
        'voltage', 'current', 'frequency', 'rpm', 'status',
        'pwm', 'manual_pwm', 'system_on', 'relay_on', 'auto_ramp_active', 'timestamp'
      ];
      Object.keys(telemetryUpdate).forEach((key) => {
        if (allowedKeys.includes(key)) {
          systemState[key] = telemetryUpdate[key];
        }
      });
      io.emit('telemetry', systemState);
      return res.json({ success: true, state: systemState });
    }

    await update(ref(db, '/'), telemetryUpdate);
    res.json({ success: true, state: telemetryUpdate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io handlers
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  
  // Send current state to newly connected client immediately
  socket.emit('telemetry', systemState);

  socket.on('control', async (data) => {
    const { command, value } = data;
    console.log(`🔌 Received Control socket message: ${command} = ${value}`);
    
    if (useSimulator) {
      handleSimulatorCommand(command, value);
    } else {
      try {
        await writeToFirebase(command, value);
      } catch (err) {
        console.error("Firebase write error:", err);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Write to Firebase helper
const writeToFirebase = async (command, value) => {
  if (!db) return;
  const updates = {};
  
  if (command === 'relay_on') {
    updates['/relay_on'] = !!value;
  } else if (command === 'system_on') {
    const systemOn = !!value;
    updates['/system_on'] = systemOn;
    if (systemOn) {
      updates['/auto_ramp_active'] = true;
      updates['/pwm'] = 0;
      // Note: Real ESP32 will handle the ramp, but we can write these states
    } else {
      updates['/auto_ramp_active'] = false;
      updates['/pwm'] = 0;
    }
  } else if (command === 'manual_pwm') {
    const pwmVal = parseInt(value, 10);
    updates['/manual_pwm'] = pwmVal;
    updates['/pwm'] = pwmVal; // Assume physical system updates pwm to match manual override
  }
  
  await update(ref(db, '/'), updates);
};

// Handle simulator state transitions locally
const handleSimulatorCommand = (command, value) => {
  if (command === 'relay_on') {
    systemState.relay_on = !!value;
  } else if (command === 'system_on') {
    systemState.system_on = !!value;
    if (systemState.system_on) {
      runSimulationRamp();
    } else {
      if (rampTimer) {
        clearInterval(rampTimer);
        rampTimer = null;
      }
      systemState.pwm = 0;
      systemState.manual_pwm = 0;
      systemState.auto_ramp_active = false;
    }
  } else if (command === 'manual_pwm') {
    if (!systemState.auto_ramp_active && systemState.system_on) {
      systemState.manual_pwm = parseInt(value, 10);
      systemState.pwm = systemState.manual_pwm;
    }
  }
  
  // Broadcast updated simulator state immediately
  io.emit('telemetry', systemState);
};

const PORT = Number(process.env.PORT || 5000);

const startServer = (port, attemptsLeft = 10) => {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const nextPort = port + 1;
      console.warn(`⚠️ Port ${port} is busy. Trying port ${nextPort} instead...`);
      server.removeListener('error', onError);
      startServer(nextPort, attemptsLeft - 1);
      return;
    }

    console.error(`❌ Failed to start server on port ${port}:`, err);
    process.exit(1);
  };

  server.once('error', onError);
  server.once('listening', () => {
    server.removeListener('error', onError);
    console.log(`🚀 Server running on port ${port}`);
  });

  server.listen(port);
};

startServer(PORT);
