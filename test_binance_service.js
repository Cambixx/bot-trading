import binanceService from './src/services/binanceService.js';

async function testBinanceService() {
    console.log('Testing Binance Service...');
    const symbols = ['BTCUSDC', 'ETHUSDC'];

    try {
        console.log('Fetching 1h data...');
        const data1h = await binanceService.getMultipleSymbolsData(symbols, '1h', 50);
        console.log('1h Data keys:', Object.keys(data1h));
        console.log('BTCUSDC 1h candles:', data1h['BTCUSDC']?.data?.length);

        console.log('Fetching 4h data...');
        const data4h = await binanceService.getMultipleSymbolsData(symbols, '4h', 50);
        console.log('BTCUSDC 4h candles:', data4h['BTCUSDC']?.data?.length);

        console.log('Fetching 15m data...');
        const data15m = await binanceService.getMultipleSymbolsData(symbols, '15m', 50);
        console.log('BTCUSDC 15m candles:', data15m['BTCUSDC']?.data?.length);

        if (data1h['BTCUSDC']?.data?.length > 0 && data4h['BTCUSDC']?.data?.length > 0) {
            console.log('SUCCESS: Data fetching works.');
        } else {
            console.error('FAILURE: Data fetching returned empty or incomplete data.');
        }

    } catch (error) {
        console.error('Error testing Binance Service:', error);
    }
}

testBinanceService();
