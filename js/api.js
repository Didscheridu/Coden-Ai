// js/api.js – die Modell-Kaskade und alle Keys liegen im Backend
import { apiJson } from './backend.js';

export async function generateAiResponse(messages, tier) {
    const data = await apiJson('/chat', { method: 'POST', body: JSON.stringify({ messages, tier }) });
    return data.content;
}
