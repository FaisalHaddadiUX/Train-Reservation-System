const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = 'https://gmjpifzyghtosnktcebn.supabase.co';
const supabaseKey = 'sb_publishable_RvYf7D1dSsi4R8YLowcjqA_Q7EpGo8O';
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/trains', async (req, res) => {
    const { data, error } = await supabase.from('trains').select('*').order('trainID');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.patch('/api/trains/:id', async (req, res) => {
    const { status, price } = req.body;
    const { error } = await supabase.from('trains').update({ status, price }).eq('trainID', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Train updated successfully.' });
});

app.post('/api/book', async (req, res) => {
    const { trainID, passengerID, name, contactNumber, paymentMethod } = req.body;
    const { data: train, error: trainError } = await supabase.from('trains').select('availableSeats').eq('trainID', trainID).single();
    if (trainError || !train || train.availableSeats <= 0) return res.status(400).json({ message: 'No seats available.' });

    const ticketStatus = paymentMethod === 'Cash at Station' ? 'Pending' : 'Confirmed';

    await supabase.from('passengers').upsert({ passengerID, name, contactNumber });
    const { data: ticket } = await supabase.from('tickets').insert([{ passengerID, trainID, paymentMethod, status: ticketStatus }]).select().single();
    await supabase.from('trains').update({ availableSeats: train.availableSeats - 1 }).eq('trainID', trainID);

    res.json({ message: 'Booking successful!', ticketNumber: ticket.ticketNumber });
});

app.patch('/api/tickets/:id/confirm', async (req, res) => {
    const { error } = await supabase.from('tickets').update({ status: 'Confirmed' }).eq('ticketNumber', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Payment confirmed and ticket activated.' });
});

app.get('/api/tickets', async (req, res) => {
    const { data: tickets } = await supabase.from('tickets').select('*').order('bookingDate', { ascending: false });
    const { data: trains } = await supabase.from('trains').select('*');
    const { data: passengers } = await supabase.from('passengers').select('*');

    const result = (tickets || []).map(t => {
        const train = (trains || []).find(tr => tr.trainID === t.trainID) || {};
        const pass = (passengers || []).find(p => p.passengerID === t.passengerID) || {};
        return {
            ticketNumber: t.ticketNumber,
            trainID: t.trainID,
            passengerID: t.passengerID,
            status: t.status,
            paymentMethod: t.paymentMethod || 'Credit Card',
            bookingDate: t.bookingDate,
            trainName: train.trainName || 'Unknown',
            departureStation: train.departureStation || 'N/A',
            arrivalStation: train.arrivalStation || 'N/A',
            departureDate: train.departureDate || 'N/A',
            price: train.price || 0,
            passengerName: pass.name || 'Unknown'
        };
    });
    res.json(result);
});

app.delete('/api/tickets/:id', async (req, res) => {
    const ticketId = req.params.id;
    const { data: ticket } = await supabase.from('tickets').select('trainID').eq('ticketNumber', ticketId).single();
    if (ticket) {
        const { error: delError } = await supabase.from('tickets').delete().eq('ticketNumber', ticketId);
        if (!delError) {
            const { data: train } = await supabase.from('trains').select('availableSeats').eq('trainID', ticket.trainID).single();
            if (train) await supabase.from('trains').update({ availableSeats: train.availableSeats + 1 }).eq('trainID', ticket.trainID);
            return res.json({ message: 'Booking cancelled.' });
        }
    }
    res.status(500).json({ error: 'Failed to delete.' });
});

app.get('/api/passenger_users', async (req, res) => {
    const { data } = await supabase.from('passenger_users').select('*');
    res.json(data || []);
});

app.post('/api/passenger_users', async (req, res) => {
    const { username, email, password, passengerID, name, contactNumber } = req.body;
    const { error } = await supabase.from('passenger_users').insert([{ username, email, password, passengerID, name, contactNumber }]);
    if (error) return res.status(400).json({ message: 'Error: Username or ID exists.' });
    await supabase.from('passengers').upsert({ passengerID, name, contactNumber });
    res.json({ message: 'Passenger account created successfully' });
});

app.get('/api/staff', async (req, res) => {
    const { data } = await supabase.from('staff_users').select('*');
    res.json(data || []);
});

// ✅ Route واحدة نظيفة لإنشاء موظف جديد (بكلمة مرور افتراضية 111111)
app.post('/api/staff', async (req, res) => {
    const { username, email } = req.body;
    const { error } = await supabase.from('staff_users').insert([{
        username,
        email,
        password: '111111'
    }]);
    if (error) {
        console.log("DB Error:", error);
        return res.status(400).json({ message: 'Username or Email already exists.' });
    }
    res.json({ message: 'Staff created successfully.' });
});

app.delete('/api/staff/:username', async (req, res) => {
    await supabase.from('staff_users').delete().eq('username', req.params.username);
    res.json({ message: 'Staff deleted' });
});

// تحديث كلمة مرور الموظف
app.patch('/api/staff/update-password', async (req, res) => {
    const { username, newPassword } = req.body;
    const { error } = await supabase.from('staff_users').update({ password: newPassword }).eq('username', username);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Password updated successfully.' });
});

app.get('/api/reports', async (req, res) => {
    const { data: trains } = await supabase.from('trains').select('*');
    const { data: tickets } = await supabase.from('tickets').select('*');
    let totalRevenue = 0;
    let occupancyData = [];

    if (trains && tickets) {
        tickets.forEach(ticket => {
            if (ticket.status === 'Confirmed') {
                const train = trains.find(t => t.trainID === ticket.trainID);
                if (train) totalRevenue += Number(train.price);
            }
        });
        occupancyData = trains.map(t => {
            const bookedSeats = t.totalCapacity - t.availableSeats;
            const occupancyRate = t.totalCapacity > 0 ? ((bookedSeats / t.totalCapacity) * 100).toFixed(1) : 0;
            return { trainID: t.trainID, trainName: t.trainName || 'Unknown', totalCapacity: t.totalCapacity, bookedSeats, occupancyRate };
        });
    }
    res.json({ totalRevenue, occupancyData });
});

// جلب بيانات المسافرين للأدمن (بدون الباسورد)
app.get('/api/admin/passengers', async (req, res) => {
    const { data, error } = await supabase.from('passenger_users').select('passengerID, name, username, email, contactNumber');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

const PORT = 3001;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
