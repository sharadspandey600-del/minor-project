const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onValue, update } = require('firebase/database');
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

// Firebase configuration
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

const isFirebaseConfigured = () => {
  return firebaseConfig.databaseURL &&
         !firebaseConfig.databaseURL.includes("YOUR_DATABASE_URL_HERE") &&
         firebaseConfig.apiKey &&
         !firebaseConfig.apiKey.includes("YOUR_API_KEY_HERE");
};

// Local cache of system state, shared shape with frontend (unchanged from before)
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

// ===================== SIMULATOR MODE (used only when Firebase is NOT configured) =====================
let simulatorInterval = null;
let rampTimer = null;

const startSimulator = () => {
  if (simulatorInterval) return;
  console.log("⚡ Starting Pico Hydropower Simulator Mode...");

  simulatorInterval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    systemState.timestamp = now;

    if (!systemState.system_on) {
      systemState.pwm = 0;
      systemState.auto_ramp_active = false;
      systemState.rpm = Math.max(0, systemState.rpm - 300);
      systemState.frequency = systemState.rpm / 60;
      systemState.voltage = Math.max(0, systemState.voltage - 15);
      systemState.current = Math.max(0, systemState.current - 20);
      systemState.status = "OFFLINE";
    } else {
      systemState.status = "OK";
      const targetRPM = systemState.pwm * 40;
      const rpmNoise = (Math.random() - 0.5) * 15;
      systemState.rpm = Math.round(systemState.rpm + (targetRPM - systemState.rpm) * 0.25 + rpmNoise);
      if (systemState.rpm < 0) systemState.rpm = 0;

      systemState.frequency = Number((systemState.rpm / 60).toFixed(1));

      const voltageNoise = (Math.random() - 0.5) * 2;
      systemState.voltage = Number((systemState.frequency * 4.25 + voltageNoise).toFixed(1));
      if (systemState.voltage < 0) systemState.voltage = 0;

      if (systemState.relay_on) {
        const loadResistance = 0.85;
        const currentNoise = (Math.random() - 0.5) * 10;
        systemState.current = Number(((systemState.voltage / loadResistance) + currentNoise).toFixed(1));
      } else {
        systemState.current = Number((Math.random() * 8 + 2).toFixed(1));
      }
    }

    io.emit('telemetry', systemState);
  }, 1000);
};

const runSimulationRamp = () => {
  if (rampTimer) clearInterval(rampTimer);
  systemState.auto_ramp_active = true;
  systemState.pwm = 0;
  console.log("🔄 Soft-start Auto Ramp Initiated: 0% -> 70% PWM");

  let elapsed = 0;
  rampTimer = setInterval(() => {
    elapsed += 0.5;
    if (elapsed >= 10) {
      clearInterval(rampTimer);
      systemState.pwm = 70;
      systemState.manual_pwm = 70;
      systemState.auto_ramp_active = false;
      console.log("✅ Soft-start Auto Ramp Completed. Manual override enabled.");
    } else {
      systemState.pwm = Math.round((elapsed / 10) * 70);
    }
    io.emit('telemetry', systemState);
  }, 500);
};

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

  io.emit('telemetry', systemState);
};

// ===================== REAL HARDWARE MODE (Firebase configured, matches ESP32 paths) =====================
// ESP32 firmware reads commands from  /control/systemOn  and  /control/loadOn
// ESP32 firmware writes telemetry to  /generator/voltage, /generator/current, /generator/rpm,
//                                      /generator/frequency, /generator/fault, /generator/timestamp
// This backend MUST read/write those exact paths to talk to the real hardware.

const DEFAULT_STARTUP_PWM = 70; // % speed the motor ramps to automatically when System is turned ON

const writeToFirebase = async (command, value) => {
  if (!db) return;
  const updates = {};

  if (command === 'relay_on') {
    updates['/control/loadOn'] = !!value;
  } else if (command === 'system_on') {
    updates['/control/systemOn'] = !!value;
    // Auto-set a default speed on power ON (mirrors the old simulator's
    // soft-start-to-70% behavior). On power OFF, bring the commanded
    // speed back to 0 so the motor/slider both settle at 0%.
    updates['/control/manualPwm'] = value ? DEFAULT_STARTUP_PWM : 0;
  } else if (command === 'manual_pwm') {
    updates['/control/manualPwm'] = parseInt(value, 10);
  }

  await update(ref(db, '/'), updates);
};

if (isFirebaseConfigured()) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    useSimulator = false;
    console.log("🔥 Connected to Firebase Realtime Database!");

    const dbRef = ref(db, '/');
    onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const control = data.control || {};
      const generator = data.generator || {};

      // NEW: keep the dashboard's slider in sync with the actual /control/manualPwm
      // value in Firebase. Without this, manual_pwm/pwm stayed stuck at their
      // initial value (0) forever, so the slider snapped back to 0 on every
      // telemetry update (including unrelated ones like toggling the relay).
      const manualPwmValue = control.manualPwm !== undefined
        ? Number(control.manualPwm)
        : systemState.manual_pwm;

      systemState = {
        ...systemState,
        system_on: !!control.systemOn,
        relay_on: !!control.loadOn,
        manual_pwm: manualPwmValue,
        pwm: manualPwmValue,
        // Real hardware ramps continuously toward whatever manualPwm is set to
        // (see ESP32 firmware), so there's no discrete "ramping" phase to lock
        // the slider during, unlike the simulator. Keep it always editable.
        auto_ramp_active: false,
        voltage: Number(generator.voltage) || 0,
        current: Number(generator.current) || 0,
        rpm: Number(generator.rpm) || 0,
        frequency: Number(generator.frequency) || 0,
        status: control.systemOn ? (generator.fault || "OK") : "OFFLINE",
        timestamp: generator.timestamp
          ? Math.floor(Number(generator.timestamp) / 1000)
          : Math.floor(Date.now() / 1000)
      };

      io.emit('telemetry', systemState);
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

// ===================== REST endpoints =====================
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

// ===================== Socket.io =====================
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
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