import axios from 'axios';
import { supabase } from '../lib/supabase';
import { publicErrorMessage } from '../utils/publicError';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.data && typeof err.response.data.error === 'string') {
      err.response.data.error = publicErrorMessage(err.response.data.error);
    } else if (!err.response) {
      err.message = publicErrorMessage(err, 'Connexion au serveur impossible. Vérifie ta connexion.');
    }
    return Promise.reject(err);
  }
);

export default api;
