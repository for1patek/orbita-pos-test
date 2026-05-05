// Configuración de Supabase
const SUPABASE_URL = "https://uldqgxdmblhyqsnxenaz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZHFneGRtYmxoeXFzbnhlbmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjY2NjUsImV4cCI6MjA5MDQwMjY2NX0.9o0GseD_yxXv-tf98w_1H2q_aJLSvyX3gh1KxIYLbMg";

// Inicialización del cliente
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Función para verificar si el usuario está logueado
async function checkUser() {
    const { data: { user } } = await _supabase.auth.getUser();

    if (!user) {
        return null;
    } else {
        console.log("Usuario autenticado:", user.email);
        return user;
    }
}

// Función para cerrar sesión
async function logout() {
    const { error } = await _supabase.auth.signOut();
    if (error) console.error("Error al cerrar sesión:", error.message);
    window.location.href = "index.html";
}

// Exponer API global para el resto del sistema
window.orbitaAuth = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_KEY,

    signIn: async (email, password) => {
        return await _supabase.auth.signInWithPassword({ email, password });
    },

    signOut: async () => {
        return await _supabase.auth.signOut();
    },

    getSession: async () => {
        return await _supabase.auth.getSession();
    },

    getUser: async () => {
        return await _supabase.auth.getUser();
    },

    updatePassword: async (newPassword) => {
        return await _supabase.auth.updateUser({ password: newPassword });
    },

    resetPassword: async (email) => {
        return await _supabase.auth.resetPasswordForEmail(email);
    },

    restHeaders: async () => {
        const { data: { session } } = await _supabase.auth.getSession();
        const token = session?.access_token || SUPABASE_KEY;
        return {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token}`
        };
    },

    adminFetch: async (url, options = {}) => {
        const headers = await window.orbitaAuth.restHeaders();
        const mergedHeaders = {
            ...headers,
            ...(options.headers || {})
        };
        return fetch(url, {
            ...options,
            headers: mergedHeaders
        });
    }
};

// Ejecutar verificación al cargar la página
document.addEventListener("DOMContentLoaded", checkUser);