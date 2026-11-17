/**
 * All pages and their URLs, in one place. Specific paths come before paths with a :parameter.
 * `section` decides which item in the side menu is highlighted.
 */
import type { ComponentType } from "react";
import Dashboard from "@/modules/dashboard/Dashboard";
import OrdersList from "@/modules/orders/OrdersList";
import OrderDetail from "@/modules/orders/OrderDetail";
import { LineCost, OrderPurchaseOrder, OrderCorrection, OrderEdit, OrderInvoice, OrderLine, OrderNew, OrderPayment, OrderWriteOff } from "@/modules/orders/OrderForms";
import { Ledger, ToPay, ToReceive, VoidPayment } from "@/modules/payments/Payments";
import { PurchaseOrderDetail, PurchaseOrderEdit, PurchaseOrderInvoice, PurchaseOrderNew, PurchaseOrderPayment, PurchaseOrderWriteOff, PurchaseOrders } from "@/modules/purchasing/Purchasing";
import { CustomerDetail, CustomerForm, Customers, SupplierDetail, SupplierForm, Suppliers } from "@/modules/parties/Parties";
import { PriceForm, Prices, ProductForm, Products } from "@/modules/catalog/Catalog";
import { BatchItemNew, BatchNew, ShipmentForm, Shipping, Stock, StockCorrection } from "@/modules/logistics/Logistics";
import Reports from "@/modules/reports/Reports";
import { Audit, Import, RateNew, Rates, SettingForm, Settings, UserForm, Users } from "@/modules/admin/Admin";

export interface Route { path: string; section: string; page: ComponentType }
const r = (path: string, section: string, page: ComponentType): Route => ({ path, section, page });

export const ROUTES: Route[] = [
  r("/", "dashboard", Dashboard),
  r("/orders", "orders", OrdersList), r("/orders/new", "orders", OrderNew),
  r("/orders/:ref", "orders", OrderDetail), r("/orders/:ref/edit", "orders", OrderEdit),
  r("/orders/:ref/lines/:line", "orders", OrderLine), r("/orders/:ref/lines/:line/cost", "orders", LineCost),
  r("/orders/:ref/payment", "orders", OrderPayment), r("/orders/:ref/invoice", "orders", OrderInvoice),
  r("/orders/:ref/correction", "orders", OrderCorrection), r("/orders/:ref/purchase-order", "orders", OrderPurchaseOrder), r("/orders/:ref/write-off", "orders", OrderWriteOff),
  r("/payments", "payments", ToReceive), r("/payments/suppliers", "payments", ToPay), r("/payments/ledger", "payments", Ledger),
  r("/payments/:id/void", "payments", VoidPayment),
  r("/purchasing", "purchasing", PurchaseOrders), r("/purchasing/new", "purchasing", PurchaseOrderNew),
  r("/purchasing/:po", "purchasing", PurchaseOrderDetail), r("/purchasing/:po/edit", "purchasing", PurchaseOrderEdit),
  r("/purchasing/:po/payment", "purchasing", PurchaseOrderPayment), r("/purchasing/:po/invoice", "purchasing", PurchaseOrderInvoice),
  r("/purchasing/:po/write-off", "purchasing", PurchaseOrderWriteOff),
  r("/customers", "customers", Customers), r("/customers/new", "customers", CustomerForm),
  r("/customers/:slug", "customers", CustomerDetail), r("/customers/:slug/edit", "customers", CustomerForm),
  r("/suppliers", "suppliers", Suppliers), r("/suppliers/new", "suppliers", SupplierForm),
  r("/suppliers/:slug", "suppliers", SupplierDetail), r("/suppliers/:slug/edit", "suppliers", SupplierForm),
  r("/products", "products", Products), r("/products/new", "products", ProductForm), r("/products/:slug", "products", ProductForm),
  r("/prices", "prices", Prices), r("/prices/new", "prices", PriceForm), r("/prices/:id", "prices", PriceForm),
  r("/shipping", "shipping", Shipping), r("/shipping/new", "shipping", ShipmentForm), r("/shipping/:ref/edit", "shipping", ShipmentForm),
  r("/stock", "stock", Stock), r("/stock/batches/new", "stock", BatchNew), r("/stock/items/new", "stock", BatchItemNew), r("/stock/corrections/new", "stock", StockCorrection),
  r("/reports", "reports", () => <Reports tab="customers" />), r("/reports/suppliers", "reports", () => <Reports tab="suppliers" />),
  r("/reports/monthly", "reports", () => <Reports tab="monthly" />), r("/reports/products", "reports", () => <Reports tab="products" />),
  r("/reports/cash-flow", "reports", () => <Reports tab="cash-flow" />),
  r("/admin", "admin", Settings), r("/admin/settings/:key", "admin", SettingForm), r("/admin/rates", "admin", Rates), r("/admin/rates/new", "admin", RateNew),
  r("/admin/users", "admin", Users), r("/admin/users/:id", "admin", UserForm), r("/admin/audit", "admin", Audit), r("/admin/import", "admin", Import),
];
