"use client";

import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ChartConfig {
  type: "bar" | "line" | "pie" | "area" | "scatter";
  title: string;
  data: Array<{ name: string; value: number; [key: string]: string | number }>;
}

interface ChartRendererProps {
  config: ChartConfig;
}

const COLORS = [
  "#10b981", "#14b8a6", "#22c55e", "#06b6d4", 
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b"
];

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800/95 backdrop-blur-sm border border-slate-700 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-emerald-400 text-sm">
            {entry.name}: {typeof entry.value === "number" 
              ? entry.value.toLocaleString("en-IN") 
              : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function ChartRenderer({ config }: ChartRendererProps) {
  const { type, title, data } = config;

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="name" 
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
              />
              <YAxis 
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
                tickFormatter={(value) => value.toLocaleString("en-IN")}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: "#9ca3af" }} />
              <Bar 
                dataKey="value" 
                fill="url(#barGradient)" 
                radius={[4, 4, 0, 0]}
                animationDuration={1000}
              />
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#14b8a6" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        );

      case "line":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="name" 
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
              />
              <YAxis 
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
                tickFormatter={(value) => value.toLocaleString("en-IN")}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: "#9ca3af" }} />
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke="#10b981" 
                strokeWidth={3}
                dot={{ fill: "#10b981", strokeWidth: 2, r: 5 }}
                activeDot={{ r: 8, stroke: "#fff", strokeWidth: 2 }}
                animationDuration={1500}
              />
            </LineChart>
          </ResponsiveContainer>
        );

      case "pie":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => 
                  percent != null ? `${name} (${(percent * 100).toFixed(0)}%)` : name
                }
                outerRadius={100}
                innerRadius={40}
                fill="#8884d8"
                dataKey="value"
                animationDuration={1000}
              >
                {data.map((_, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={COLORS[index % COLORS.length]} 
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: "#9ca3af" }} />
            </PieChart>
          </ResponsiveContainer>
        );

      case "area":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="name" 
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
              />
              <YAxis 
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
                tickFormatter={(value) => value.toLocaleString("en-IN")}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: "#9ca3af" }} />
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke="#10b981" 
                strokeWidth={2}
                fill="url(#areaGradient)"
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      case "scatter":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="name" 
                type="category"
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
              />
              <YAxis 
                dataKey="value"
                tick={{ fill: "#9ca3af", fontSize: 12 }} 
                axisLine={{ stroke: "#4b5563" }}
                tickFormatter={(value) => value.toLocaleString("en-IN")}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: "#9ca3af" }} />
              <Scatter 
                name="Values" 
                data={data} 
                fill="#10b981"
                animationDuration={1000}
              />
            </ScatterChart>
          </ResponsiveContainer>
        );

      default:
        return (
          <div className="h-[300px] flex items-center justify-center text-slate-400">
            Unsupported chart type: {type}
          </div>
        );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-4 overflow-hidden"
    >
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        {title}
      </h3>
      {renderChart()}
    </motion.div>
  );
}
