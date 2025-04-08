/**
 * Telegraf uchun oddiy xotira saqlash moduli
 * Sessiya ma'lumotlarini operativ xotirada saqlash uchun
 */
class MemoryStorage {
    constructor() {
      this.storage = new Map();
    }
  
    /**
     * Kalit bo'yicha sessiya ma'lumotlarini olish
     * @param {string} key - Sessiya kaliti
     * @returns {Promise<Object>} Sessiya ma'lumotlari
     */
    async get(key) {
      if (this.storage.has(key)) {
        return JSON.parse(this.storage.get(key));
      }
      return undefined;
    }
  
    /**
     * Sessiya ma'lumotlarini saqlash
     * @param {string} key - Sessiya kaliti
     * @param {Object} data - Sessiya ma'lumotlari
     * @returns {Promise<undefined>}
     */
    async set(key, data) {
      this.storage.set(key, JSON.stringify(data));
      return undefined;
    }
  
    /**
     * Sessiya ma'lumotlarini o'chirish
     * @param {string} key - Sessiya kaliti
     * @returns {Promise<undefined>}
     */
    async delete(key) {
      this.storage.delete(key);
      return undefined;
    }
  
    /**
     * Barcha sessiya ma'lumotlarini tozalash
     * @returns {Promise<undefined>}
     */
    async clear() {
      this.storage.clear();
      return undefined;
    }
  }
  
  module.exports = MemoryStorage;