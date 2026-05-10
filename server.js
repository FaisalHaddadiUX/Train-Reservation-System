const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ ضع رابط مشروعك ومفتاح الوصول (Anon Key) من لوحة تحكم Supabase هنا ⚠️
const supabaseUrl = 'https://gmjpifzyghtosnktcebn.supabase.co';
const supabaseKey = 'sb_publishable_RvYf7D1dSsi4R8YLowcjqA_Q7EpGo8O';
const supabase = createClient(supabaseUrl, supabaseKey);

// واجهة عرض صفحة HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. واجهة البحث عن القطارات (Search Trains)
app.get('/api/trains', async (req, res) => {
    const { dep, arr } = req.query;
    
    // استرجاع القطارات التي بها مقاعد متاحة
    let query = supabase.from('trains').select('*').gt('availableSeats', 0);

    if (dep && arr) {
        query = query.eq('departureStation', dep).eq('arrivalStation', arr);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// 2. واجهة الحجز (Process Reservation)
app.post('/api/book', async (req, res) => {
    const { trainID, passengerID, name, contactNumber } = req.body;

    // أ. التحقق من توفر المقاعد أولاً
    const { data: train, error: trainError } = await supabase
        .from('trains')
        .select('availableSeats')
        .eq('trainID', trainID)
        .single();

    if (trainError || !train || train.availableSeats <= 0) {
        return res.status(400).json({ message: 'No seats available on this train.' });
    }

    // ب. إضافة المسافر (أو تحديث بياناته إذا كان موجوداً - Upsert)
    const { error: passengerError } = await supabase
        .from('passengers')
        .upsert({ passengerID, name, contactNumber });

    if (passengerError) return res.status(500).json({ error: passengerError.message });

    // ج. إنشاء التذكرة
    const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert([{ passengerID, trainID }])
        .select()
        .single();

    if (ticketError) return res.status(500).json({ error: ticketError.message });

    // د. تقليل عدد المقاعد المتاحة
    const { error: updateError } = await supabase
        .from('trains')
        .update({ availableSeats: train.availableSeats - 1 })
        .eq('trainID', trainID);

    if (updateError) return res.status(500).json({ error: updateError.message });

    res.json({ 
        message: 'Booking successful!', 
        ticketNumber: ticket.ticketNumber 
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});