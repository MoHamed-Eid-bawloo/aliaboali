import { create } from 'zustand';
import { openDB } from 'idb';
import { z } from 'zod';
import { createClient, type User } from '@supabase/supabase-js';

export type Product = { id: string; name: string; brand: string; model: string; category: string; color: string; storage: string; quantity: number; purchasePrice: number; sellingPrice: number; lowStockLimit: number; warranty: string; createdAt: string; updatedAt: string; deleted?: boolean };
export type Contact = { id: string; name: string; company?: string; phone: string; address: string; notes: string; createdAt: string; updatedAt: string; deleted?: boolean };
export type Item = { productId: string; name: string; quantity: number; price: number; purchasePrice: number };
export type Invoice = { id: string; number: string; contactId: string; contactName: string; date: string; items: Item[]; discount: number; subtotal: number; total: number; paid: number; remaining: number; paymentMethod: string; notes: string };
export type Cash = { id: string; type: string; amount: number; direction: 'in' | 'out'; date: string; description: string; sourceId?: string };
export type Expense = { id: string; category: string; description: string; amount: number; date: string; paymentMethod: string; notes: string };

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
const dbp = openDB('mobile-shop-db', 2, { upgrade(db) { if (!db.objectStoreNames.contains('state')) db.createObjectStore('state'); } });

type Data = { shopName: string; products: Product[]; sales: Invoice[]; purchases: Invoice[]; customers: Contact[]; suppliers: Contact[]; expenses: Expense[]; cash: Cash[] };
const empty: Data = { shopName: 'متجر الهاتف', products: [], sales: [], purchases: [], customers: [], suppliers: [], expenses: [], cash: [] };
type Store = Data & {
  ready: boolean; user: User | null; cloudEnabled: boolean; error: string;
  saveProduct: (value: Product) => void; deleteProduct: (id: string) => void; saveContact: (value: Contact, supplier: boolean) => void; deleteContact: (id: string, supplier: boolean) => void; invoice: (value: Invoice, purchase: boolean) => void; deleteInvoice: (id: string, purchase: boolean) => void; expense: (value: Expense) => void; deleteExpense: (id: string) => void; cashIn: (value: Cash) => void; deleteCash: (id: string) => void; setName: (value: string) => void;
  backup: () => unknown; restore: (value: unknown) => Promise<void>; signIn: (email: string, password: string) => Promise<string | null>; signUp: (email: string, password: string) => Promise<string | null>; signOut: () => Promise<void>;
};

const pick = (state: Store): Data => ({ shopName: state.shopName, products: state.products, sales: state.sales, purchases: state.purchases, customers: state.customers, suppliers: state.suppliers, expenses: state.expenses, cash: state.cash });
const errorText = (message: string) => `لم يتم الحفظ في Supabase: ${message}`;
let saveQueue = Promise.resolve();

function persist(data: Data, user: User | null) {
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await (await dbp).put('state', data, 'main');
    if (!user || !supabase) return;
    useShop.setState({ error: '' });
    const { error } = await supabase.from('shop_data').upsert(
      { owner_id: user.id, data, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id' },
    );
    if (error) useShop.setState({ error: errorText(error.message) });
  });
  return saveQueue;
}

function change(update: Partial<Data>) {
  useShop.setState(state => {
    const next = { ...pick(state), ...update };
    void persist(next, state.user);
    return update;
  });
}

export const useShop = create<Store>((set, get) => ({
  ...empty, ready: false, user: null, cloudEnabled: !!supabase, error: '',
  saveProduct: value => change({ products: [value, ...get().products.filter(item => item.id !== value.id)] }),
  deleteProduct: id => change({ products: get().products.filter(item => item.id !== id) }),
  saveContact: (value, supplier) => {
    const collection = supplier ? 'suppliers' : 'customers';
    change({ [collection]: [value, ...get()[collection].filter(item => item.id !== value.id)] } as Partial<Data>);
  },
  deleteContact: (id, supplier) => {
    const collection = supplier ? 'suppliers' : 'customers';
    change({ [collection]: get()[collection].filter(item => item.id !== id) } as Partial<Data>);
  },
  invoice: (value, purchase) => {
    const collection = purchase ? 'purchases' : 'sales';
    const products = get().products.map(product => {
      const item = value.items.find(entry => entry.productId === product.id);
      return item ? { ...product, quantity: product.quantity + (purchase ? item.quantity : -item.quantity), updatedAt: value.date } : product;
    });
    const cash = value.paid ? { id: crypto.randomUUID(), sourceId: value.id, type: purchase ? 'دفعة مورد' : 'مبيعات', amount: value.paid, direction: purchase ? 'out' as const : 'in' as const, date: value.date, description: `فاتورة ${value.number}` } : null;
    change({ [collection]: [value, ...get()[collection]], products, cash: cash ? [cash, ...get().cash] : get().cash } as Partial<Data>);
  },
  deleteInvoice: (id, purchase) => {
    const collection = purchase ? 'purchases' : 'sales';
    const invoice = get()[collection].find(item => item.id === id);
    if (!invoice) return;
    const products = get().products.map(product => {
      const item = invoice.items.find(entry => entry.productId === product.id);
      return item ? { ...product, quantity: product.quantity + (purchase ? -item.quantity : item.quantity), updatedAt: new Date().toISOString() } : product;
    });
    change({ [collection]: get()[collection].filter(item => item.id !== id), products, cash: get().cash.filter(item => item.sourceId !== id) } as Partial<Data>);
  },
  expense: value => {
    const cash = value.paymentMethod === 'نقدي' ? { id: crypto.randomUUID(), sourceId: value.id, type: 'مصروفات', amount: value.amount, direction: 'out' as const, date: value.date, description: value.description } : null;
    change({ expenses: [value, ...get().expenses], cash: cash ? [cash, ...get().cash] : get().cash });
  },
  deleteExpense: id => change({ expenses: get().expenses.filter(item => item.id !== id), cash: get().cash.filter(item => item.sourceId !== id) }),
  cashIn: value => change({ cash: [value, ...get().cash] }),
  deleteCash: id => change({ cash: get().cash.filter(item => item.id !== id) }),
  setName: value => change({ shopName: value }),
  backup: () => ({ version: 2, exportedAt: new Date().toISOString(), data: pick(get()) }),
  restore: async value => { const backup = z.object({ version: z.number(), data: z.any() }).parse(value); change({ ...empty, ...backup.data }); },
  signIn: async (email, password) => { if (!supabase) return 'أضف إعدادات Supabase أولاً'; const { error } = await supabase.auth.signInWithPassword({ email, password }); return error?.message ?? null; },
  signUp: async (email, password) => { if (!supabase) return 'أضف إعدادات Supabase أولاً'; const { error } = await supabase.auth.signUp({ email, password }); return error?.message ?? null; },
  signOut: async () => { await supabase?.auth.signOut(); set({ ...empty, user: null, ready: true, error: '' }); },
}));

async function boot(user: User | null) {
  if (!user) {
    const data = await (await dbp).get('state', 'main');
    useShop.setState({ ...empty, ...data, user: null, ready: true });
    return;
  }
  const { data, error } = await supabase!.from('shop_data').select('data').eq('owner_id', user.id).maybeSingle();
  if (error) {
    const local = await (await dbp).get('state', 'main');
    useShop.setState({ ...empty, ...local, user, ready: true, error: errorText(error.message) });
    return;
  }
  const state = data?.data || await (await dbp).get('state', 'main') || empty;
  if (!data) void persist(state, user);
  useShop.setState({ ...empty, ...state, user, ready: true, error: '' });
}

if (supabase) {
  void supabase.auth.getSession().then(result => boot(result.data.session?.user ?? null));
  supabase.auth.onAuthStateChange((_event, session) => { void boot(session?.user ?? null); });
} else {
  void boot(null);
}
