

// ─── PROMO CODE CONFIG ────────────────────────────────────────────────────────
export const PROMO_CODES = {
    'FAIQ10':  { label: '10% off',  type: 'percent', value: 10  },
    'WELCOME': { label: 'R100 off', type: 'fixed',   value: 100 },
    'SA2025':  { label: '5% off',   type: 'percent', value: 5   },
};

export const FITMENT_COST = 250;
export const VAT_RATE     = 0.15;

// ─── TYRE ─────────────────────────────────────────────────────────────────────
/**
 * Represents a single tyre product.
 * Encapsulates: id, name, size, price, description, imageurl, costPrice
 */
export class Tyre {
    constructor({ id, name, size, price, description = '', imageurl = null, costPrice = null }) {
        this.id          = id;
        this.name        = name;
        this.size        = size;
        this.price       = Number(price);
        this.description = description;
        this.imageurl    = imageurl;
        this.costPrice   = costPrice !== null ? Number(costPrice) : null;
    }

    /** Returns the brand extracted from the name (first word). */
    get brand() {
        return this.name?.split(' ')[0]?.toUpperCase() || 'UNKNOWN';
    }

    /** Returns the rim size in inches extracted from the size string (e.g. 16 from "205/55R16"). */
    get rimInches() {
        const m = (this.size || '').match(/R(\d{2})/i);
        return m ? parseInt(m[1]) : null;
    }

    /** Returns a plain object suitable for storing in Firestore. */
    toFirestore() {
        return {
            name        : this.name,
            size        : this.size,
            price       : this.price,
            description : this.description,
            imageurl    : this.imageurl,
            costPrice   : this.costPrice,
        };
    }

    /** Factory: build a Tyre from a raw Firestore document snapshot. */
    static fromFirestore(docSnap) {
        return new Tyre({ id: docSnap.id, ...docSnap.data() });
    }

    /** Factory: build a Tyre from a plain object (e.g. API response). */
    static fromObject(obj) {
        return new Tyre(obj);
    }
}

// ─── TYRE REPOSITORY ─────────────────────────────────────────────────────────
/**
 * Data access layer for the Tires Firestore collection.
 * Encapsulates all Firestore queries so the rest of the app
 * does not need to know about collection names or query syntax.
 */
export class TyreRepository {
    /**
     * @param {import("firebase/firestore").Firestore} db
     * @param {Function} collection
     * @param {Function} getDocs
     * @param {Function} addDoc
     * @param {Function} deleteDoc
     * @param {Function} doc
     */
    constructor(db, { collection, getDocs, addDoc, deleteDoc, doc }) {
        this._db         = db;
        this._collection = collection;
        this._getDocs    = getDocs;
        this._addDoc     = addDoc;
        this._deleteDoc  = deleteDoc;
        this._doc        = doc;
    }

    /** Fetch all tyres from Firestore. Returns an array of Tyre instances. */
    async getAll() {
        const snap = await this._getDocs(this._collection(this._db, 'Tires'));
        return snap.docs.map(d => Tyre.fromFirestore(d));
    }

    /** Add a new tyre to Firestore. Accepts a plain object or a Tyre instance. */
    async add(tyreData) {
        const tyre = tyreData instanceof Tyre ? tyreData : new Tyre(tyreData);
        const ref  = await this._addDoc(this._collection(this._db, 'Tires'), tyre.toFirestore());
        return new Tyre({ id: ref.id, ...tyre.toFirestore() });
    }

    /** Delete a tyre by its Firestore document ID. */
    async delete(tyreId) {
        await this._deleteDoc(this._doc(this._db, 'Tires', tyreId));
    }

    /**
     * Build the pipe-delimited inventory string expected by the AI backend.
     * Format: "id|name|size|price|description"
     */
    static buildInventoryString(tyres) {
        return tyres.map(t => `${t.id}|${t.name}|${t.size}|${t.price}|${t.description}`).join('\n');
    }
}

// ─── CART ITEM ────────────────────────────────────────────────────────────────
/**
 * One line item inside a shopping cart.
 * Encapsulates: tyre reference data + quantity.
 */
export class CartItem {
    constructor({ id, name, size, description = '', price, qty = 1 }) {
        this.id          = id;
        this.name        = name;
        this.size        = size;
        this.description = description;
        this.price       = Number(price);
        this.qty         = Math.max(1, Number(qty));
    }

    get lineTotal() {
        return this.price * this.qty;
    }

    incrementQty(delta = 1) {
        this.qty = Math.max(1, this.qty + delta);
    }

    toPlainObject() {
        return { id: this.id, name: this.name, size: this.size, description: this.description, price: this.price, qty: this.qty };
    }
}

// ─── CART ─────────────────────────────────────────────────────────────────────
/**
 * Full shopping cart.
 * Handles: add/remove/update items, promo codes, totals calculation,
 *          localStorage persistence.
 */
export class Cart {
    constructor(storageKey = 'faiq_cart') {
        this._storageKey = storageKey;
        this.items       = [];
        this.promoCode   = null;
        this.fitment     = false;
        this.fitmentSlot = '';
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    load() {
        try {
            const saved = localStorage.getItem(this._storageKey);
            if (saved) {
                const raw = JSON.parse(saved);
                this.items = raw.map(i => new CartItem(i));
            }
        } catch (_) {
            this.items = [];
        }
        return this;
    }

    save() {
        try {
            localStorage.setItem(this._storageKey, JSON.stringify(this.items.map(i => i.toPlainObject())));
        } catch (_) {}
        return this;
    }

    clear() {
        this.items = [];
        this.promoCode = null;
        this.fitment = false;
        this.fitmentSlot = '';
        this.save();
        return this;
    }

    // ── Item management ───────────────────────────────────────────────────────

    addItem(tyre) {
        const existing = this.items.find(i => i.id === tyre.id);
        if (existing) {
            existing.incrementQty(1);
        } else {
            this.items.push(new CartItem(tyre));
        }
        this.save();
        return this;
    }

    removeItem(index) {
        this.items.splice(index, 1);
        this.save();
        return this;
    }

    updateQty(index, delta) {
        if (this.items[index]) {
            this.items[index].incrementQty(delta);
            this.save();
        }
        return this;
    }

    get isEmpty() {
        return this.items.length === 0;
    }

    // ── Promo codes ───────────────────────────────────────────────────────────

    applyPromo(code) {
        const upperCode = (code || '').trim().toUpperCase();
        if (!upperCode) return { ok: false, message: 'Please enter a promo code.' };
        const found = PROMO_CODES[upperCode];
        if (!found) {
            this.promoCode = null;
            return { ok: false, message: 'Invalid promo code. Please try again.' };
        }
        this.promoCode = { code: upperCode, ...found };
        return { ok: true, message: `✓ Code applied: ${found.label}` };
    }

    // ── Totals calculation ────────────────────────────────────────────────────

    calcTotals() {
        const subtotal = this.items.reduce((sum, i) => sum + i.lineTotal, 0);
        const fitCost  = this.fitment ? FITMENT_COST : 0;

        let discount = 0;
        if (this.promoCode) {
            discount = this.promoCode.type === 'percent'
                ? Math.round(subtotal * this.promoCode.value / 100)
                : Math.min(this.promoCode.value, subtotal);
        }

        const beforeVat = subtotal + fitCost - discount;
        const vat       = Math.round(beforeVat * VAT_RATE);
        const total     = beforeVat + vat;

        return { subtotal, fitCost, discount, vat, total };
    }
}

// ─── ORDER ────────────────────────────────────────────────────────────────────
/**
 * An immutable order payload.
 * Built from a Cart + user details, ready to be saved to Firestore.
 */
export class Order {
    constructor({ cart, user, phone, vehicle, notes, deliveryMethod, deliveryAddress, deliveryLabel, fitmentDate }) {
        const { subtotal, fitCost, discount, vat, total } = cart.calcTotals();

        this.ref      = 'FT-' + Date.now().toString().slice(-6);
        this.status   = 'pending';

        this.customer = {
            name    : user.displayName || '',
            email   : user.email,
            uid     : user.uid,
            phone   : phone,
            vehicle : vehicle || null,
            notes   : notes   || null,
        };

        this.items = cart.items.map(i => ({
            id        : i.id,
            name      : i.name,
            size      : i.size,
            qty       : i.qty,
            unitPrice : i.price,
            lineTotal : i.lineTotal,
        }));

        this.fitment = {
            requested : cart.fitment,
            date      : cart.fitment ? fitmentDate   : null,
            slot      : cart.fitment ? cart.fitmentSlot : null,
            cost      : fitCost,
        };

        this.delivery = {
            method  : deliveryMethod,
            label   : deliveryLabel,
            address : deliveryMethod === 'delivery'
                ? deliveryAddress
                : '8 Campground Road, Rondebosch, Cape Town',
        };

        this.totals    = { subtotal, fitment: fitCost, discount, vat, total };
        this.promoCode = cart.promoCode ? cart.promoCode.code : null;
    }

    /** Returns the full payload to be written to Firestore (adds serverTimestamp). */
    toFirestore(serverTimestamp) {
        return {
            ref       : this.ref,
            status    : this.status,
            placedAt  : serverTimestamp(),
            customer  : this.customer,
            items     : this.items,
            fitment   : this.fitment,
            delivery  : this.delivery,
            totals    : this.totals,
            promoCode : this.promoCode,
        };
    }
}

// ─── WISHLIST MANAGER ─────────────────────────────────────────────────────────
/**
 * Manages the user's wishlist.
 * If the user is signed in, persists to Firestore.
 * If not signed in, keeps in memory only.
 */
export class WishlistManager {
    constructor(db, { doc, setDoc, getDoc, deleteField }) {
        this._db          = db;
        this._doc         = doc;
        this._setDoc      = setDoc;
        this._getDoc      = getDoc;
        this._deleteField = deleteField;
        this.items        = [];   // array of plain tyre objects { id, name, size, price }
    }

    isWishlisted(tyreId) {
        return this.items.some(t => t.id === tyreId);
    }

    async toggle(tyre, userEmail) {
        if (this.isWishlisted(tyre.id)) {
            this.items = this.items.filter(t => t.id !== tyre.id);
            if (userEmail) await this._removeFromFirestore(tyre.id, userEmail);
            return { added: false };
        } else {
            const entry = { id: tyre.id, name: tyre.name, size: tyre.size, price: tyre.price };
            this.items.push(entry);
            if (userEmail) await this._saveToFirestore(entry, userEmail);
            return { added: true };
        }
    }

    async loadFromFirestore(userEmail, allTyres) {
        try {
            const ref  = this._doc(this._db, 'Wishlist', userEmail);
            const snap = await this._getDoc(ref);
            if (!snap.exists()) return;
            const data  = snap.data();
            this.items  = [];
            for (const [tyreId, tyreSize] of Object.entries(data)) {
                const full = allTyres.find(t => t.id === tyreId);
                this.items.push(full
                    ? { id: full.id, name: full.name, size: full.size, price: full.price }
                    : { id: tyreId, name: tyreId, size: tyreSize, price: '—' }
                );
            }
        } catch (e) {
            console.error('WishlistManager.loadFromFirestore:', e);
        }
    }

    async _saveToFirestore(entry, userEmail) {
        try {
            const ref = this._doc(this._db, 'Wishlist', userEmail);
            await this._setDoc(ref, { [entry.id]: entry.size }, { merge: true });
        } catch (e) {
            console.error('WishlistManager._saveToFirestore:', e);
        }
    }

    async _removeFromFirestore(tyreId, userEmail) {
        try {
            const ref = this._doc(this._db, 'Wishlist', userEmail);
            await this._setDoc(ref, { [tyreId]: this._deleteField() }, { merge: true });
        } catch (e) {
            console.error('WishlistManager._removeFromFirestore:', e);
        }
    }

    clear() {
        this.items = [];
    }
}

// ─── AUTH MANAGER ─────────────────────────────────────────────────────────────
/**
 * Wraps Firebase Auth and the Users Firestore collection.
 * Resolves the user's role and guards admin-only access.
 */
export class AuthManager {
    static ADMIN_EMAIL = 'theguys5611@gmail.com';

    constructor(auth, db, { doc, getDoc, setDoc }) {
        this._auth   = auth;
        this._db     = db;
        this._doc    = doc;
        this._getDoc = getDoc;
        this._setDoc = setDoc;

        this.user     = null;
        this.role     = 'customer';
        this.joinDate = '';
    }

    get isAdmin() {
        return this.role === 'admin';
    }

    get isLoggedIn() {
        return this.user !== null;
    }

    /**
     * Call after successful Google sign-in.
     * Reads/writes the Users collection, assigns admin role if needed.
     */
    async resolveUserProfile(firebaseUser) {
        const userRef     = this._doc(this._db, 'Users', firebaseUser.uid);
        const existingDoc = await this._getDoc(userRef);
        const isNew       = !existingDoc.exists();
        const existingRole = isNew ? 'customer' : (existingDoc.data().role || 'customer');
        const assignedRole = firebaseUser.email === AuthManager.ADMIN_EMAIL ? 'admin' : existingRole;

        await this._setDoc(userRef, {
            displayName : firebaseUser.displayName,
            email       : firebaseUser.email,
            role        : assignedRole,
            lastLogin   : new Date(),
            ...(isNew && { createdAt: new Date() }),
        }, { merge: true });

        this.user = firebaseUser;
        this.role = assignedRole;

        if (!isNew && existingDoc.data().createdAt?.toDate) {
            this.joinDate = existingDoc.data().createdAt.toDate()
                .toLocaleDateString('en-ZA', { year: 'numeric', month: 'long' });
        }

        return { isNew, role: assignedRole };
    }

    /**
     * Loads the user profile from Firestore after auth state restores.
     * Returns role and joinDate.
     */
    async loadProfile(firebaseUser) {
        const userRef = this._doc(this._db, 'Users', firebaseUser.uid);
        const snap    = await this._getDoc(userRef);
        if (snap.exists()) {
            const data    = snap.data();
            this.role     = data.role || 'customer';
            if (data.createdAt?.toDate) {
                this.joinDate = data.createdAt.toDate()
                    .toLocaleDateString('en-ZA', { year: 'numeric', month: 'long' });
            }
        }
        this.user = firebaseUser;
        return { role: this.role, joinDate: this.joinDate };
    }

    logout() {
        this.user     = null;
        this.role     = 'customer';
        this.joinDate = '';
    }

    /**
     * Redirects to the login page if the user is not an admin.
     * Call this at the top of any admin-only initialisation path.
     */
    guardAdmin(redirectUrl = 'Authorisation.html') {
        if (!this.isAdmin) {
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    }
}

// ─── VALIDATOR ────────────────────────────────────────────────────────────────
/**
 * Form validation helper.
 * Each method returns { valid: boolean, message: string }.
 */
export class Validator {
    static required(value, fieldName = 'This field') {
        return (value && value.trim().length > 0)
            ? { valid: true,  message: '' }
            : { valid: false, message: `${fieldName} is required.` };
    }

    static phone(value) {
        // South African numbers: 10 digits starting with 0, or +27 followed by 9 digits
        const cleaned = (value || '').replace(/\s+/g, '');
        const saPattern = /^(\+27|0)[0-9]{9}$/.test(cleaned);
        return saPattern
            ? { valid: true,  message: '' }
            : { valid: false, message: 'Please enter a valid South African phone number (e.g. 0821234567).' };
    }

    static email(value) {
        const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return pattern.test(value || '')
            ? { valid: true,  message: '' }
            : { valid: false, message: 'Please enter a valid email address.' };
    }

    static positiveNumber(value, fieldName = 'Value') {
        const n = Number(value);
        return (!isNaN(n) && n > 0)
            ? { valid: true,  message: '' }
            : { valid: false, message: `${fieldName} must be a positive number.` };
    }

    static tyreSizeFormat(value) {
        // Matches formats like 205/55R16, 265/60R20, 185/65R15
        const pattern = /^\d{3}\/\d{2}[ZP]?R\d{2}$/i;
        return pattern.test((value || '').replace(/\s/g, ''))
            ? { valid: true,  message: '' }
            : { valid: false, message: 'Tyre size must be in the format 205/55R16.' };
    }

    /**
     * Validate the checkout form fields.
     * Returns { valid: boolean, errors: string[] }
     */
    static checkoutForm({ phone, deliveryMethod, deliveryAddress, cart, fitment, fitmentSlot, fitmentDate }) {
        const errors = [];

        const phoneCheck = Validator.phone(phone);
        if (!phoneCheck.valid) errors.push(phoneCheck.message);

        if (!deliveryMethod) errors.push('Please select a collection or delivery method.');
        if (deliveryMethod === 'delivery') {
            const addrCheck = Validator.required(deliveryAddress, 'Delivery address');
            if (!addrCheck.valid) errors.push(addrCheck.message);
        }

        if (!cart || cart.length === 0) errors.push('Your cart is empty.');

        if (fitment) {
            if (!fitmentDate) errors.push('Please select a fitment date.');
            if (!fitmentSlot) errors.push('Please select a fitment time slot.');
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * Validate the add-tyre admin form.
     * Returns { valid: boolean, errors: string[] }
     */
    static addTyreForm({ name, price, size }) {
        const errors = [];

        const nameCheck  = Validator.required(name,  'Brand / Name');
        const priceCheck = Validator.positiveNumber(price, 'Price');

        if (!nameCheck.valid)  errors.push(nameCheck.message);
        if (!priceCheck.valid) errors.push(priceCheck.message);
        if (size) {
            const sizeCheck = Validator.tyreSizeFormat(size);
            if (!sizeCheck.valid) errors.push(sizeCheck.message);
        }

        return { valid: errors.length === 0, errors };
    }
}
