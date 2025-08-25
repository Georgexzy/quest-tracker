const CACHE_NAME = 'quest-tracker-v3';
const DATA_CACHE_NAME = 'quest-data-v2';
const HEALTH_CACHE_NAME = 'health-data-v1';

// App shell files to cache
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com/3.4.17',
  'https://sdk.scdn.co/spotify-player.js'
];

// IndexedDB setup for health data
const DB_NAME = 'QuestTrackerHealthDB';
const DB_VERSION = 1;
const STORES = {
  STEPS: 'steps',
  HEALTH_DATA: 'healthData',
  QUESTS: 'quests',
  HABITS: 'habits',
  ACHIEVEMENTS: 'achievements'
};

// Initialize IndexedDB
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create stores if they don't exist
      Object.values(STORES).forEach(storeName => {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          
          // Add indexes based on store type
          if (storeName === STORES.STEPS) {
            store.createIndex('date', 'date', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          } else if (storeName === STORES.HEALTH_DATA) {
            store.createIndex('type', 'type', { unique: false });
            store.createIndex('date', 'date', { unique: false });
          } else if (storeName === STORES.QUESTS) {
            store.createIndex('category', 'category', { unique: false });
            store.createIndex('status', 'status', { unique: false });
          }
        }
      });
    };
  });
}

// Database operations
async function saveToStore(storeName, data) {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readwrite');
  const store = transaction.objectStore(storeName);
  
  // Add timestamp if not present
  if (!data.timestamp) {
    data.timestamp = Date.now();
  }
  
  return new Promise((resolve, reject) => {
    const request = store.add(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateInStore(storeName, data) {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readwrite');
  const store = transaction.objectStore(storeName);
  
  data.updatedAt = Date.now();
  
  return new Promise((resolve, reject) => {
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getFromStore(storeName, id) {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);
  
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllFromStore(storeName) {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);
  
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStepsByDateRange(startDate, endDate) {
  const db = await initDB();
  const transaction = db.transaction([STORES.STEPS], 'readonly');
  const store = transaction.objectStore(storeName);
  const index = store.index('date');
  
  const range = IDBKeyRange.bound(startDate, endDate);
  
  return new Promise((resolve, reject) => {
    const request = index.getAll(range);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Install event
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        console.log('[ServiceWorker] Pre-caching offline page');
        return cache.addAll(FILES_TO_CACHE);
      }),
      initDB()
    ])
  );
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key !== CACHE_NAME && key !== DATA_CACHE_NAME && key !== HEALTH_CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Fetch event with enhanced health data handling
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Handle share target for health data
  if (url.pathname === '/share-data' && event.request.method === 'POST') {
    event.respondWith(handleSharedData(event.request));
    return;
  }
  
  // Handle health data API calls
  if (url.pathname.includes('/api/health') || url.pathname.includes('/api/steps')) {
    event.respondWith(handleHealthAPI(event.request));
    return;
  }
  
  // Handle regular API calls
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      caches.open(DATA_CACHE_NAME).then(cache => {
        return fetch(event.request)
          .then(response => {
            if (response.status === 200) {
              cache.put(event.request.url, response.clone());
            }
            return response;
          }).catch(() => {
            return cache.match(event.request);
          });
      })
    );
    return;
  }

  // Handle app shell
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(response => {
        return response || fetch(event.request);
      });
    })
  );
});

// Handle shared health data
async function handleSharedData(request) {
  try {
    const formData = await request.formData();
    const text = formData.get('text');
    const healthDataFile = formData.get('healthData');
    
    let healthData = null;
    
    if (healthDataFile) {
      const fileText = await healthDataFile.text();
      try {
        healthData = JSON.parse(fileText);
      } catch (e) {
        // Try to parse as CSV or other formats
        healthData = parseHealthDataText(fileText);
      }
    } else if (text) {
      try {
        healthData = JSON.parse(text);
      } catch (e) {
        healthData = parseHealthDataText(text);
      }
    }
    
    if (healthData) {
      await processHealthData(healthData);
      
      // Notify the main app
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'HEALTH_DATA_RECEIVED',
          data: healthData
        });
      });
    }
    
    // Redirect to main app
    return Response.redirect('/', 302);
  } catch (error) {
    console.error('[ServiceWorker] Error handling shared data:', error);
    return new Response('Error processing health data', { status: 500 });
  }
}

// Handle health API requests
async function handleHealthAPI(request) {
  const url = new URL(request.url);
  const method = request.method;
  
  try {
    if (method === 'GET') {
      if (url.pathname.includes('/steps')) {
        const params = url.searchParams;
        const startDate = params.get('startDate');
        const endDate = params.get('endDate');
        
        let stepsData;
        if (startDate && endDate) {
          stepsData = await getStepsByDateRange(startDate, endDate);
        } else {
          stepsData = await getAllFromStore(STORES.STEPS);
        }
        
        return new Response(JSON.stringify(stepsData), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else if (url.pathname.includes('/health')) {
        const healthData = await getAllFromStore(STORES.HEALTH_DATA);
        return new Response(JSON.stringify(healthData), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else if (method === 'POST') {
      const data = await request.json();
      
      if (url.pathname.includes('/steps')) {
        await saveToStore(STORES.STEPS, data);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else if (url.pathname.includes('/health')) {
        await saveToStore(STORES.HEALTH_DATA, data);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('[ServiceWorker] Health API error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Parse health data from various text formats
function parseHealthDataText(text) {
  const lines = text.split('\n');
  const data = [];
  
  // Try to detect CSV format
  if (text.includes(',')) {
    lines.forEach((line, index) => {
      if (index === 0) return; // Skip header
      const parts = line.split(',');
      if (parts.length >= 2) {
        data.push({
          date: parts[0]?.trim(),
          steps: parseInt(parts[1]?.trim()) || 0,
          type: 'steps'
        });
      }
    });
  } else {
    // Try to extract step numbers from text
    const stepMatches = text.match(/(\d{1,5})\s*steps?/gi);
    if (stepMatches) {
      stepMatches.forEach(match => {
        const steps = parseInt(match.match(/\d+/)[0]);
        data.push({
          date: new Date().toISOString().split('T')[0],
          steps: steps,
          type: 'steps'
        });
      });
    }
  }
  
  return data;
}

// Process and store health data
async function processHealthData(healthData) {
  if (!Array.isArray(healthData)) {
    healthData = [healthData];
  }
  
  for (const item of healthData) {
    if (item.type === 'steps' || item.steps !== undefined) {
      await saveToStore(STORES.STEPS, {
        date: item.date || new Date().toISOString().split('T')[0],
        steps: item.steps || item.value || 0,
        source: item.source || 'shared',
        metadata: item.metadata || {}
      });
    } else {
      await saveToStore(STORES.HEALTH_DATA, item);
    }
  }
  
  // Update quest progress based on steps
  await updateQuestProgress();
}

// Update quest progress based on health data
async function updateQuestProgress() {
  try {
    const quests = await getAllFromStore(STORES.QUESTS);
    const today = new Date().toISOString().split('T')[0];
    const todaySteps = await getStepsByDateRange(today, today);
    
    const totalStepsToday = todaySteps.reduce((sum, entry) => sum + entry.steps, 0);
    
    // Update step-related quests
    for (const quest of quests) {
      if (quest.category === 'fitness' || quest.type === 'steps') {
        let updated = false;
        
        if (quest.target && quest.target.steps) {
          quest.progress = Math.min(totalStepsToday, quest.target.steps);
          quest.completed = quest.progress >= quest.target.steps;
          updated = true;
        }
        
        if (updated) {
          await updateInStore(STORES.QUESTS, quest);
        }
      }
    }
    
    // Notify main app of progress updates
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'QUEST_PROGRESS_UPDATED',
        data: { totalStepsToday, updatedQuests: quests.filter(q => q.category === 'fitness') }
      });
    });
    
  } catch (error) {
    console.error('[ServiceWorker] Error updating quest progress:', error);
  }
}

// Background sync
self.addEventListener('sync', event => {
  console.log('[ServiceWorker] Background sync', event.tag);
  
  switch (event.tag) {
    case 'background-sync-quests':
      event.waitUntil(syncQuests());
      break;
    case 'background-sync-habits':
      event.waitUntil(syncHabits());
      break;
    case 'background-sync-health':
      event.waitUntil(syncHealthData());
      break;
    case 'update-quest-progress':
      event.waitUntil(updateQuestProgress());
      break;
  }
});

// Enhanced message handling
self.addEventListener('message', event => {
  console.log('[ServiceWorker] Message received', event.data);
  
  if (event.data && event.data.type) {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
        
      case 'SAVE_STEPS_DATA':
        saveToStore(STORES.STEPS, event.data.data).then(() => {
          updateQuestProgress();
        });
        break;
        
      case 'SAVE_HEALTH_DATA':
        saveToStore(STORES.HEALTH_DATA, event.data.data);
        break;
        
      case 'SAVE_QUEST_DATA':
        saveToStore(STORES.QUESTS, event.data.data);
        break;
        
      case 'GET_STEPS_DATA':
        getAllFromStore(STORES.STEPS).then(data => {
          event.ports[0].postMessage({ data });
        });
        break;
        
      case 'GET_QUEST_DATA':
        getAllFromStore(STORES.QUESTS).then(data => {
          event.ports[0].postMessage({ data });
        });
        break;
        
      case 'SYNC_REQUEST':
        self.registration.sync.register(event.data.tag);
        break;
        
      case 'SCHEDULE_NOTIFICATION':
        scheduleNotification(event.data.notification);
        break;
        
      case 'UPDATE_QUEST_PROGRESS':
        updateQuestProgress();
        break;
    }
  }
});

// Enhanced sync functions
async function syncQuests() {
  try {
    console.log('[ServiceWorker] Syncing quests in background');
    await updateQuestProgress();
    
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'BACKGROUND_SYNC_COMPLETE',
        data: { type: 'quests', success: true }
      });
    });
  } catch (error) {
    console.error('[ServiceWorker] Error syncing quests:', error);
  }
}

async function syncHabits() {
  try {
    console.log('[ServiceWorker] Syncing habits in background');
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'BACKGROUND_SYNC_COMPLETE', 
        data: { type: 'habits', success: true }
      });
    });
  } catch (error) {
    console.error('[ServiceWorker] Error syncing habits:', error);
  }
}

async function syncHealthData() {
  try {
    console.log('[ServiceWorker] Syncing health data in background');
    await updateQuestProgress();
    
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'BACKGROUND_SYNC_COMPLETE',
        data: { type: 'health', success: true }
      });
    });
  } catch (error) {
    console.error('[ServiceWorker] Error syncing health data:', error);
  }
}

// Enhanced notification handling
self.addEventListener('push', event => {
  console.log('[ServiceWorker] Push received');
  
  let notificationData = {
    title: 'Quest Tracker Pro',
    body: 'Check your quest progress!',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏆</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏆</text></svg>',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: Math.random()
    },
    actions: [
      {
        action: 'open',
        title: 'Open App',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏆</text></svg>'
      },
      {
        action: 'close',
        title: 'Dismiss',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">✕</text></svg>'
      }
    ]
  };

  if (event.data) {
    try {
      const pushData = event.data.json();
      notificationData = { ...notificationData, ...pushData };
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Notification click handling
self.addEventListener('notificationclick', event => {
  console.log('[ServiceWorker] Notification click received');
  
  event.notification.close();

  if (event.action === 'open') {
    event.waitUntil(clients.openWindow('/'));
  } else if (event.action === 'close') {
    return;
  } else {
    event.waitUntil(
      clients.matchAll().then(clientList => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Utility functions
function scheduleNotification(notificationData) {
  console.log('[ServiceWorker] Scheduling notification:', notificationData);
  
  setTimeout(() => {
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏆</text></svg>',
      badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏆</text></svg>',
      tag: notificationData.tag || 'quest-reminder',
      requireInteraction: false,
      actions: [
        { action: 'open', title: 'Open App' },
        { action: 'close', title: 'Dismiss' }
      ]
    });
  }, notificationData.delay || 1000);
}

// Periodic background sync
self.addEventListener('periodicsync', event => {
  if (event.tag === 'daily-quest-check') {
    event.waitUntil(checkDailyQuests());
  } else if (event.tag === 'health-data-sync') {
    event.waitUntil(syncHealthData());
  }
});

async function checkDailyQuests() {
  try {
    console.log('[ServiceWorker] Checking daily quests');
    
    await updateQuestProgress();
    
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'DAILY_QUEST_CHECK',
        data: { timestamp: Date.now() }
      });
    });
  } catch (error) {
    console.error('[ServiceWorker] Error checking daily quests:', error);
  }
}

// Network status monitoring
function broadcastNetworkStatus() {
  const isOnline = navigator.onLine;
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'NETWORK_STATUS_CHANGE',
        data: { isOnline }
      });
    });
  });
}

self.addEventListener('online', broadcastNetworkStatus);
self.addEventListener('offline', broadcastNetworkStatus);

console.log('[ServiceWorker] Enhanced Service Worker with Health Data Support loaded');
