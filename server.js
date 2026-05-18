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
    const { trainID, passengerID, name, contactNumber } = req.body;
    const { data: train, error: trainError } = await supabase.from('trains').select('availableSeats').eq('trainID', trainID).single();
    if (trainError || !train || train.availableSeats <= 0) return res.status(400).json({ message: 'No seats available.' });

    await supabase.from('passengers').upsert({ passengerID, name, contactNumber });
    const { data: ticket } = await supabase.from('tickets').insert([{ passengerID, trainID }]).select().single();
    await supabase.from('trains').update({ availableSeats: train.availableSeats - 1 }).eq('trainID', trainID);

    res.json({ message: 'Booking successful!', ticketNumber: ticket.ticketNumber });
});

app.get('/api/tickets', async (req, res) => {
    const { data: tickets } = await supabase.from('tickets').select('*').order('bookingDate', { ascending: false });
    const { data: trains } = await supabase.from('trains').select('*');
    const { data: passengers } = await supabase.from('passengers').select('*');

    const result = (tickets || []).map(t => {
        const train = (trains || []).find(tr => tr.trainID === t.trainID) || {};
        const pass = (passengers || []).find(p => p.passengerID === t.passengerID) || {};
        return { ...t, trains: { trainName: train.trainName || 'Unknown', departureDate: train.departureDate || '' }, passengers: { name: pass.name || 'Unknown' } };
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
            if(train) await supabase.from('trains').update({ availableSeats: train.availableSeats + 1 }).eq('trainID', ticket.trainID);
            return res.json({ message: 'Booking cancelled.' });
        }
    }
    res.status(500).json({ error: 'Failed to delete.' });
});


app.get('/api/staff', async (req, res) => {
    const { data, error } = await supabase.from('staff_users').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

app.post('/api/staff', async (req, res) => {
    const { username, email, password } = req.body;
    const { error } = await supabase.from('staff_users').insert([{ username, email, password }]);
    if (error) return res.status(400).json({ message: 'Error: Username or Email might already exist.' });
    res.json({ message: 'Staff created successfully' });
});

app.delete('/api/staff/:username', async (req, res) => {
    const { error } = await supabase.from('staff_users').delete().eq('username', req.params.username);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Staff deleted successfully' });
});

app.get('/api/reports', async (req, res) => {
    
    const { data: trains } = await supabase.from('trains').select('*');
    const { data: tickets } = await supabase.from('tickets').select('*');

    let totalRevenue = 0;
    let occupancyData = [];

    if (trains && tickets) {
       
        tickets.forEach(ticket => {
            const train = trains.find(t => t.trainID === ticket.trainID);
            if (train) totalRevenue += Number(train.price);
        });

   
        occupancyData = trains.map(t => {
            const bookedSeats = t.totalCapacity - t.availableSeats;
          
            const occupancyRate = t.totalCapacity > 0 ? ((bookedSeats / t.totalCapacity) * 100).toFixed(1) : 0;
            
            return {
                trainID: t.trainID,
                trainName: t.trainName || 'Unknown Route',
                totalCapacity: t.totalCapacity,
                bookedSeats: bookedSeats,
                occupancyRate: occupancyRate
            };
        });
    }

    res.json({ totalRevenue, occupancyData });
});

const PORT = 3000;
const server = app.listen(PORT, () => {
    console.log(`✅ Server is successfully running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
    console.error('❌ Server Error:', err);
});
