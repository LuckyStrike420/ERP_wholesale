/**
 * All pages and their URLs, in one place. Specific paths come before paths with a :parameter.
 * `section` decides which item in the side menu is highlighted.
 */
import type { ComponentType } from "react";
import Dashboard from "@/modules/dashboard/Dashboard";
import OrdersList from "@/modules/orders/OrdersList";
import OrderDetail from "@/modules/orders/OrderDetail";
import OrderComposer from "@/modules/orders/OrderComposer";
import ProformaInvoice, { CommercialInvoice } from "@/modules/orders/ProformaInvoice";
import { ShippingDocumentEdit, ShippingDocumentNew } from "@/modules/documents/ShippingDocument";
import { PurchaseOrderDocument } from "@/modules/purchasing/PurchaseOrderDocument";
import { CustomerContactForm, SupplierContactForm } from "@/modules/parties/Contacts";
import { BatchDetail, BatchForm, BatchItemForm } from "@/modules/stock/Batches";
import { ReportBuilder } from "@/modules/reports/Custom";
import { Approvals, ApprovalPolicies, ApprovalPolicyForm } from "@/modules/approvals/Approvals";
import { LineCost, OrderPurchaseOrder, OrderCorrection, OrderEdit, OrderInvoice, OrderLine, OrderPayment, OrderWriteOff } from "@/modules/orders/OrderForms";
import { Ledger, ToPay, ToReceive, VoidPayment } from "@/modules/payments/Payments";
import { PurchaseOrderDetail, PurchaseOrderEdit, PurchaseOrderInvoice, PurchaseOrderNew, PurchaseOrderPayment, PurchaseOrderWriteOff, PurchaseOrders } from "@/modules/purchasing/Purchasing";
import { CustomerDetail, CustomerForm, Customers, SupplierDetail, SupplierForm, Suppliers } from "@/modules/parties/Parties";
import { PriceForm, Prices, ProductForm, Products } from "@/modules/catalog/Catalog";
import { ShipmentForm, Shipping, Stock, StockCorrection } from "@/modules/logistics/Logistics";
import Reports from "@/modules/reports/Reports";
import { Audit, Import, RateNew, Rates, SettingForm, Settings, UserForm, Users } from "@/modules/admin/Admin";
import { PaymentTermForm, PaymentTerms } from "@/modules/admin/PaymentTerms";
import { AutomationForm, Automations } from "@/modules/admin/Automations";
import { TaskForm, Tasks } from "@/modules/tasks/Tasks";

export interface Route { path: string; section: string; page: ComponentType }
const r = (path: string, section: string, page: ComponentType): Route => ({ path, section, page });

export const ROUTES: Route[] = [
  r("/", "dashboard", Dashboard),
  r("/orders", "orders", OrdersList), r("/orders/new", "orders", OrderComposer),
  r("/orders/:ref", "orders", OrderDetail), r("/orders/:ref/edit", "orders", OrderEdit),
  r("/orders/:ref/lines/:line", "orders", OrderLine), r("/orders/:ref/lines/:line/cost", "orders", LineCost),
  r("/orders/:ref/payment", "orders", OrderPayment), r("/orders/:ref/invoice", "orders", OrderInvoice),
  r("/orders/:ref/correction", "orders", OrderCorrection), r("/orders/:ref/purchase-order", "orders", OrderPurchaseOrder), r("/orders/:ref/pi", "orders", ProformaInvoice), r("/orders/:ref/commercial-invoice", "orders", CommercialInvoice),
  r("/orders/:ref/documents/new", "orders", ShippingDocumentNew), r("/orders/:ref/documents/:doc", "orders", ShippingDocumentEdit), r("/orders/:ref/write-off", "orders", OrderWriteOff),
  r("/payments", "payments", ToReceive), r("/payments/suppliers", "payments", ToPay), r("/payments/ledger", "payments", Ledger),
  r("/payments/:id/void", "payments", VoidPayment),
  r("/approvals", "approvals", () => <Approvals tab="open" />), r("/approvals/all", "approvals", () => <Approvals tab="all" />),
  r("/admin/approvals", "admin", ApprovalPolicies), r("/admin/approvals/new", "admin", ApprovalPolicyForm), r("/admin/approvals/:id", "admin", ApprovalPolicyForm),
  r("/tasks", "tasks", Tasks), r("/tasks/new", "tasks", TaskForm), r("/tasks/:id", "tasks", TaskForm),
  r("/purchasing", "purchasing", PurchaseOrders), r("/purchasing/new", "purchasing", PurchaseOrderNew),
  r("/purchasing/:po", "purchasing", PurchaseOrderDetail), r("/purchasing/:po/edit", "purchasing", PurchaseOrderEdit),
  r("/purchasing/:po/payment", "purchasing", PurchaseOrderPayment), r("/purchasing/:po/invoice", "purchasing", PurchaseOrderInvoice),
  r("/purchasing/:po/write-off", "purchasing", PurchaseOrderWriteOff), r("/purchasing/:po/pdf", "purchasing", PurchaseOrderDocument),
  r("/customers", "customers", Customers), r("/customers/new", "customers", CustomerForm),
  r("/customers/:slug", "customers", CustomerDetail), r("/customers/:slug/edit", "customers", CustomerForm),
  r("/customers/:slug/contacts/new", "customers", CustomerContactForm), r("/customers/:slug/contacts/:id", "customers", CustomerContactForm),
  r("/suppliers", "suppliers", Suppliers), r("/suppliers/new", "suppliers", SupplierForm),
  r("/suppliers/:slug", "suppliers", SupplierDetail), r("/suppliers/:slug/edit", "suppliers", SupplierForm),
  r("/suppliers/:slug/contacts/new", "suppliers", SupplierContactForm), r("/suppliers/:slug/contacts/:id", "suppliers", SupplierContactForm),
  r("/products", "products", Products), r("/products/new", "products", ProductForm), r("/products/:slug", "products", ProductForm),
  r("/prices", "prices", Prices), r("/prices/new", "prices", PriceForm), r("/prices/:id", "prices", PriceForm),
  r("/shipping", "shipping", Shipping), r("/shipping/new", "shipping", ShipmentForm), r("/shipping/:ref/edit", "shipping", ShipmentForm),
  r("/stock", "stock", Stock), r("/stock/batches/new", "stock", BatchForm), r("/stock/batches/:batch", "stock", BatchDetail), r("/stock/batches/:batch/edit", "stock", BatchForm),
  r("/stock/items/new", "stock", BatchItemForm), r("/stock/items/:id", "stock", BatchItemForm), r("/stock/corrections/new", "stock", StockCorrection),
  r("/reports", "reports", () => <Reports tab="customers" />), r("/reports/suppliers", "reports", () => <Reports tab="suppliers" />),
  r("/reports/monthly", "reports", () => <Reports tab="monthly" />), r("/reports/products", "reports", () => <Reports tab="products" />),
  r("/reports/cash-flow", "reports", () => <Reports tab="cash-flow" />), r("/reports/custom", "reports", () => <Reports tab="custom" />),
  r("/reports/custom/new", "reports", ReportBuilder), r("/reports/custom/:id", "reports", ReportBuilder),
  r("/admin", "admin", Settings), r("/admin/settings/:key", "admin", SettingForm),
  r("/admin/automations", "admin", Automations), r("/admin/automations/new", "admin", AutomationForm), r("/admin/automations/:id", "admin", AutomationForm),
  r("/admin/payment-terms", "admin", PaymentTerms), r("/admin/payment-terms/new", "admin", PaymentTermForm), r("/admin/payment-terms/:id", "admin", PaymentTermForm), r("/admin/rates", "admin", Rates), r("/admin/rates/new", "admin", RateNew),
  r("/admin/users", "admin", Users), r("/admin/users/:id", "admin", UserForm), r("/admin/audit", "admin", Audit), r("/admin/import", "admin", Import),
];
