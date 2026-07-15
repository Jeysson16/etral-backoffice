import { localRepository } from "./localRepository.js";
import { hasSupabaseConfig, supabaseRepository } from "./supabaseRepository.js";

export function getRepository() {
  if (import.meta.env.VITE_DATA_MODE === "mock") return localRepository;
  return hasSupabaseConfig() ? supabaseRepository : supabaseRepository;
}
