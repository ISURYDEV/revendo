import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SnapshotProvider } from './components/SnapshotContext';
import { ToastHost } from './components/Toast';
import Dashboard from './screens/Dashboard';
import UrssafScreen from './screens/Urssaf';
import StockScreen from './screens/Stock';
import AddExpense from './screens/AddExpense';
import AddStock from './screens/AddStock';
import Review from './screens/Review';
import SearchScreen from './screens/Search';
import SettingsScreen from './screens/Settings';

export default function App() {
  return (
    <SnapshotProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="urssaf" element={<UrssafScreen />} />
          <Route path="stock" element={<StockScreen />} />
          <Route path="search" element={<SearchScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="add-expense" element={<AddExpense />} />
          <Route path="add-stock" element={<AddStock />} />
          <Route path="review" element={<Review />} />
        </Route>
      </Routes>
      <ToastHost />
    </SnapshotProvider>
  );
}
