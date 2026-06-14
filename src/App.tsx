import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useGlobalShortcuts } from './lib/useShortcuts';
import Layout from './components/Layout';
import { Skeleton } from './components/Skeleton';
import { notify } from './lib/notify';

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Imports = React.lazy(() => import('./pages/Imports'));
const ReviewCenter = React.lazy(() => import('./pages/ReviewCenter'));
const Sales = React.lazy(() => import('./pages/Sales'));
const JustificatifsVentes = React.lazy(() => import('./pages/JustificatifsVentes'));
const Documents = React.lazy(() => import('./pages/Documents'));
const Purchases = React.lazy(() => import('./pages/Purchases'));
const Stock = React.lazy(() => import('./pages/Stock'));
const Expenses = React.lazy(() => import('./pages/Expenses'));
const Declarations = React.lazy(() => import('./pages/Declarations'));
const Profitability = React.lazy(() => import('./pages/Profitability'));
const Agenda = React.lazy(() => import('./pages/Agenda'));
const Settings = React.lazy(() => import('./pages/Settings'));

export default function App() {
  useGlobalShortcuts();
  useEffect(() => {
    const off = window.revendo.on?.('automation:done', (payload) => {
      const data = payload as { error?: string; stock?: { linked?: number; created?: number; ambiguous?: number } };
      if (data?.error) {
        notify(data.error, 'warning', 'Automatisation');
        return;
      }
      const stock = data?.stock;
      if (stock) {
        notify(`Liaison automatique : ${stock.linked ?? 0} liées, ${stock.created ?? 0} créées, ${stock.ambiguous ?? 0} ambiguës.`, 'success', 'Automatisation terminée');
      }
    });
    return () => off?.();
  }, []);
  return (
    <Layout>
      <Suspense fallback={<Skeleton />}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/imports" element={<Imports />} />
          <Route path="/review" element={<ReviewCenter />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/justificatifs-ventes" element={<JustificatifsVentes />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/declarations" element={<Declarations />} />
          <Route path="/rentabilite" element={<Profitability />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
