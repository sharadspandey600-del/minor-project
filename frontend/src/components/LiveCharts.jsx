import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const LiveCharts = ({ historyData }) => {
  // Format timestamps for the labels (last 50-60 readings)
  const labels = historyData.map(d => {
    const date = new Date(d.timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });

  // Graph 1: Voltage and Frequency Tracking
  const voltageFrequencyData = {
    labels,
    datasets: [
      {
        label: 'Voltage (V)',
        data: historyData.map(d => d.voltage),
        borderColor: '#06b6d4', // Cyan
        backgroundColor: 'rgba(6, 182, 212, 0.1)',
        yAxisID: 'y-voltage',
        tension: 0.3,
        pointRadius: historyData.length > 30 ? 0 : 2,
        borderWidth: 2,
      },
      {
        label: 'Frequency (Hz)',
        data: historyData.map(d => d.frequency),
        borderColor: '#10b981', // Emerald Green
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        yAxisID: 'y-frequency',
        tension: 0.3,
        pointRadius: historyData.length > 30 ? 0 : 2,
        borderWidth: 2,
      }
    ]
  };

  const voltageFrequencyOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e2e8f0',
          font: { family: 'Outfit', size: 11 }
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: '#11162b',
        titleFont: { family: 'Outfit' },
        bodyFont: { family: 'JetBrains Mono' },
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#94a3b8',
          font: { family: 'JetBrains Mono', size: 9 },
          maxRotation: 45,
          maxTicksLimit: 8
        }
      },
      'y-voltage': {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Voltage (V)',
          color: '#06b6d4',
          font: { family: 'Outfit', weight: 'bold' }
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono' } },
        min: 0,
        max: 300
      },
      'y-frequency': {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Frequency (Hz)',
          color: '#10b981',
          font: { family: 'Outfit', weight: 'bold' }
        },
        grid: { drawOnChartArea: false }, // Only keep left gridlines
        ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono' } },
        min: 0,
        max: 75
      }
    }
  };

  // Graph 2: RPM and Frequency Correlation
  const rpmFrequencyData = {
    labels,
    datasets: [
      {
        label: 'Speed (RPM)',
        data: historyData.map(d => d.rpm),
        borderColor: '#f59e0b', // Amber
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        yAxisID: 'y-rpm',
        tension: 0.3,
        pointRadius: historyData.length > 30 ? 0 : 2,
        borderWidth: 2,
      },
      {
        label: 'Frequency (Hz)',
        data: historyData.map(d => d.frequency),
        borderColor: '#10b981', // Emerald Green (same as above for correlation matching)
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        yAxisID: 'y-frequency',
        tension: 0.3,
        pointRadius: historyData.length > 30 ? 0 : 2,
        borderWidth: 2,
      }
    ]
  };

  const rpmFrequencyOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e2e8f0',
          font: { family: 'Outfit', size: 11 }
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: '#11162b',
        titleFont: { family: 'Outfit' },
        bodyFont: { family: 'JetBrains Mono' },
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#94a3b8',
          font: { family: 'JetBrains Mono', size: 9 },
          maxRotation: 45,
          maxTicksLimit: 8
        }
      },
      'y-rpm': {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Speed (RPM)',
          color: '#f59e0b',
          font: { family: 'Outfit', weight: 'bold' }
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono' } },
        min: 0,
        max: 4500
      },
      'y-frequency': {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Frequency (Hz)',
          color: '#10b981',
          font: { family: 'Outfit', weight: 'bold' }
        },
        grid: { drawOnChartArea: false },
        ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono' } },
        min: 0,
        max: 75
      }
    }
  };

  return (
    <div className="charts-grid">
      <div className="dashboard-card">
        <h3 className="dashboard-card-title">Voltage vs Frequency</h3>
        <div className="chart-wrapper">
          <Line data={voltageFrequencyData} options={voltageFrequencyOptions} />
        </div>
      </div>
      
      <div className="dashboard-card">
        <h3 className="dashboard-card-title">Speed (RPM) vs Frequency</h3>
        <div className="chart-wrapper">
          <Line data={rpmFrequencyData} options={rpmFrequencyOptions} />
        </div>
      </div>
    </div>
  );
};

export default LiveCharts;
