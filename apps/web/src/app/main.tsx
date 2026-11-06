import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { App as AntApp, ConfigProvider, Result, Spin } from 'antd';
import idID from 'antd/locale/id_ID';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import { AuthProvider, useAuth } from './auth';
import Shell from './Shell';
import { Dashboard, Login, Profile } from '../features/home/Home';
import { SalesDetail, SalesList } from '../features/sales/Sales';
import { NeedPurchaseList, PODetail, POList, SupplierPricelist } from '../features/purchasing/Purchasing';
import { InvoiceDetail, InvoiceList, PaymentsList, ReadyToInvoice } from '../features/billing/Billing';
import {
  ReadyToShipList,
  StockMoves,
  StockOverview,
  StockRules,
  TransferDetail,
  TransferList,
} from '../features/stock/Stock';
import {
  AccountsPage,
  BankReconPage,
  CashPage,
  JournalDetail,
  JournalList,
  LedgerPage,
  TrialBalancePage,
} from '../features/accounting/Accounting';
import {
  CategoriesUnits,
  PartnerDetail,
  PartnerList,
  PaymentTerms,
  ProductDetail,
  ProductList,
  SalesPricelists,
} from '../features/master/Master';
import {
  ApiKeysPage,
  CompanyPage,
  DocumentSettings,
  EmailOutbox,
  GroupsPage,
  ImportPage,
  UserDetail,
  UsersList,
} from '../features/settings/Settings';
import { ReportView, ReportsHome } from '../features/reports/Reports';
import { DocumentEditor, DocumentList } from '../features/documents/Documents';

const theme = {
  token: {
    colorPrimary: '#90241D',
    colorLink: '#90241D',
    colorInfo: '#90241D',
    colorError: '#90241D',
    colorWarning: '#F2C500',
    colorSuccess: '#15803d',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: 8,
    colorBgLayout: '#ffffff',
    colorBorderSecondary: '#ECE8E4',
    colorText: '#2E2A27',
    colorTextSecondary: '#625B55',
    controlHeight: 36,
    fontSize: 14,
  },
  components: {
    Table: { headerBg: '#ffffff', headerColor: '#90241D', rowHoverBg: '#FDF6F5' },
    Button: { fontWeight: 500 },
    Tabs: { titleFontSize: 15 },
  },
};
// dialog statis (Modal.confirm, info, warning) dirender di luar pohon React, jadi perlu tema yang sama
ConfigProvider.config({
  holderRender: (children) => (
    <ConfigProvider theme={theme} locale={idID}>
      {children}
    </ConfigProvider>
  ),
});

function Guard({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading)
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
const NotFound = () => <Result status="404" title="Halaman tidak ditemukan" />;

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Guard>
            <Shell />
          </Guard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="profil" element={<Profile />} />
        <Route path="penjualan" element={<SalesList />} />
        <Route path="penjualan/pelanggan" element={<PartnerList kind="customer" />} />
        <Route path="penjualan/pelanggan/:id" element={<PartnerDetail kind="customer" />} />
        <Route path="penjualan/pricelist" element={<SalesPricelists />} />
        <Route path="penjualan/:id" element={<SalesDetail />} />
        <Route path="pengadaan" element={<POList />} />
        <Route path="pengadaan/tagihan" element={<InvoiceList type="bill" />} />
        <Route path="pengadaan/tagihan/:id" element={<InvoiceDetail type="bill" />} />
        <Route path="pengadaan/pricelist" element={<SupplierPricelist />} />
        <Route path="pengadaan/principal" element={<PartnerList kind="supplier" />} />
        <Route path="pengadaan/principal/:id" element={<PartnerDetail kind="supplier" />} />
        <Route path="pengadaan/perlu-pesanan" element={<NeedPurchaseList />} />
        <Route path="pengadaan/:id" element={<PODetail />} />
        <Route path="stok" element={<StockOverview />} />
        <Route path="stok/penerimaan" element={<TransferList kind="incoming" />} />
        <Route path="stok/siap-dikirim" element={<ReadyToShipList />} />
        <Route path="stok/surat-jalan" element={<TransferList kind="outgoing" />} />
        <Route path="stok/dok/:id" element={<TransferDetail />} />
        <Route path="stok/minimum" element={<StockRules />} />
        <Route path="stok/mutasi" element={<StockMoves />} />
        <Route path="penagihan" element={<InvoiceList type="invoice" />} />
        <Route path="penagihan/siap" element={<ReadyToInvoice />} />
        <Route path="penagihan/pembayaran" element={<PaymentsList />} />
        <Route path="penagihan/:id" element={<InvoiceDetail type="invoice" />} />
        <Route path="akuntansi/kas" element={<CashPage />} />
        <Route path="akuntansi/jurnal" element={<JournalList />} />
        <Route path="akuntansi/jurnal/:id" element={<JournalDetail />} />
        <Route path="akuntansi/akun" element={<AccountsPage />} />
        <Route path="akuntansi/buku-besar" element={<LedgerPage />} />
        <Route path="akuntansi/neraca-saldo" element={<TrialBalancePage />} />
        <Route path="akuntansi/rekonsiliasi" element={<BankReconPage />} />
        <Route path="master/pelanggan" element={<PartnerList kind="customer" />} />
        <Route path="master/pelanggan/:id" element={<PartnerDetail kind="customer" />} />
        <Route path="master/principal" element={<PartnerList kind="supplier" />} />
        <Route path="master/principal/:id" element={<PartnerDetail kind="supplier" />} />
        <Route path="master/produk" element={<ProductList />} />
        <Route path="master/produk/:id" element={<ProductDetail />} />
        <Route path="master/kategori" element={<CategoriesUnits />} />
        <Route path="master/top" element={<PaymentTerms />} />
        <Route path="master/pricelist" element={<SalesPricelists />} />
        <Route path="pengaturan/pengguna" element={<UsersList />} />
        <Route path="pengaturan/pengguna/:id" element={<UserDetail />} />
        <Route path="pengaturan/grup" element={<GroupsPage />} />
        <Route path="pengaturan/email" element={<EmailOutbox />} />
        <Route path="pengaturan/perusahaan" element={<CompanyPage />} />
        <Route path="pengaturan/dokumen" element={<DocumentSettings />} />
        <Route path="pengaturan/impor" element={<ImportPage />} />
        <Route path="pengaturan/api" element={<ApiKeysPage />} />
        <Route path="dokumen" element={<DocumentList />} />
        <Route path="dokumen/baru" element={<DocumentEditor />} />
        <Route path="dokumen/:id" element={<DocumentEditor />} />
        <Route path="laporan" element={<ReportsHome />} />
        <Route path="laporan/:key" element={<ReportView />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={theme} locale={idID}>
      <AntApp>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
