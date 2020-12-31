const { expectRevert } = require('@openzeppelin/test-helpers');
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const { assert } = require("console");
const { promises } = require("dns");
const { isTopic } = require("web3-utils");

const Dai = artifacts.require('mocks/Dai.sol');
const Zrx = artifacts.require('mocks/Zrx.sol');
const Rep = artifacts.require('mocks/Rep.sol');
const Bat = artifacts.require('mocks/Bat.sol');
const Dex = artifacts.require('Dex.sol');

const SIDE = {BUY: 0, SELL: 1}; // this is to make it more readable when specifying buy/sell orders in test

contract('Dex', (accounts) => {
    let dai, bat, rep, zrx, dex;
    const [trader1, trader2] = [accounts[1], accounts[2]];
    const [DAI, BAT, REP, ZRX] = ['DAI', 'BAT', 'REP', 'ZRX']
        .map(ticker => web3.utils.fromAscii(ticker));

    beforeEach(async() => {
        ([dai, bat, rep, zrx] = await Promise.all([
            Dai.new(),
            Bat.new(),
            Rep.new(),
            Zrx.new()
        ]));
        dex = await Dex.new();
        await Promise.all([
            dex.addToken(DAI, dai.address),
            dex.addToken(BAT, bat.address),
            dex.addToken(REP,rep.address),
            dex.addToken(ZRX, zrx.address),
        ]);

        //This is our faucet to automatically give
        const amount = web3.utils.toWei('1000');
        const seedTokenBalance = async (token, trader) => {
            await token.faucet(trader, amount);
            await token.approve(dex.address, amount, {from: trader});
        }

        await Promise.all(
            [dai, bat, rep, zrx].map(
                token => seedTokenBalance(token, trader1)
            )
        );

        await Promise.all(
            [dai, bat, rep, zrx].map(
                token => seedTokenBalance(token, trader2)
            )
        );
    });


    // Happy pass scenario to test users able to deposit DAI into account
    it('should deposit tokens', async () => {
        const amount = web3.utils.toWei('100');
        await dex.deposit(amount, DAI, {from: trader1});
    
        const balance = await dex.traderBalances(trader1, DAI);
        assert(balance.toString() === amount);
    });

    // Unhappy test scenario where user attempts to deposit tokens not used on exchange
    it('should not deposit unapproved tokens', async () => {
        await expectRevert(
            dex.deposit(
                web3.utils.toWei('100'),
                web3.utils.fromAscii('TOKEN-DOES-NOT-EXIST'),
                {from: trader1}
            ),
            'this token does not exist'
        );
    });

    // Happy pass scenario to test users able to withdraw DAI into account
    it('should withdraw tokens', async () => {
        const amount = web3.utils.toWei('100');
        await dex.deposit(amount, DAI, {from: trader1});
        await dex.withdraw(amount, DAI, {from: trader1});
        const [balanceDex, balanceDai] = await Promise.all([
            dex.traderBalances(trader1, DAI),
            dai.balanceOf(trader1)
        ]);
        assert(balanceDex.isZero());
        assert(balanceDai.toString() === web3.utils.toWei('1000'));
    });

    // Unhappy test scenario where user attempts to withdraw tokens not used on exchange
    it('should not withdraw unapproved tokens', async () => {
        await expectRevert(
            dex.withdraw(
                web3.utils.toWei('100'),
                web3.utils.fromAscii('TOKEN-DOES-NOT-EXIST'),
                {from: trader1}
            ),
            'this token does not exist'
        );
    });
    
    // Unhappy test scenario to verify token balance check, preventing users from overwithdrawing   
    it('should not withdraw tokens if balance is too low', async () => {
        const amount = web3.utils.toWei('100');
        await dex.deposit(amount, DAI, {from: trader1});
        await expectRevert(
            dex.withdraw(
                web3.utils.toWei('1000'),
                DAI,
                {from: trader1}
            ),
            'trader does not have enough funds to withdraw'
        );
    });

    // Testing happy path for Buy limit order
    it('should be able to create a limit order', async () => {
        //Trader 1 will deposit 100 DAI and create a limit order for 10 REP tokens for a price of 10/per
        await dex.deposit(web3.utils.toWei('100'), DAI, {from: trader1});
        await dex.createLimitOrder(REP, web3.utils.toWei('10'), 10, SIDE.BUY, {from: trader1}); 

        // creating variables to fetch the but and sell orders
        let buyOrders = await dex.getOrders(REP, SIDE.BUY);
        let sellOrders = await dex.getOrders(REP, SIDE.SELL);

        // assert statements to validate that the order was added with correct data and nothing was added to sell orders
        assert(buyOrders.length === 1);
        assert(buyOrders[0].trader === trader1);
        assert(buyOrders[0].ticker === web3.utils.padRight(REP, 64));
        assert(buyOrders[0].price === '10');
        assert(buyOrders[0].amount === web3.utils.toWei('10'));
        assert(sellOrders.length === 0);

        //Trader 2 will deposit 200 DAI and create a limit order for 10 REP tokens for a price of 11/per, should be first in our array
        await dex.deposit(web3.utils.toWei('200'), DAI, {from: trader2});
        await dex.createLimitOrder(REP, web3.utils.toWei('10'), 11, SIDE.BUY, {from: trader2}); 
        buyOrders = await dex.getOrders(REP, SIDE.BUY);
        sellOrders = await dex.getOrders(REP, SIDE.SELL);

        // assert statements to validate that the second order was added in the correct order with correct data and nothing was added to sell orders
        assert(buyOrders.length === 2);
        assert(buyOrders[0].trader === trader2);
        assert(buyOrders[1].trader === trader1);
        assert(sellOrders.length === 0);

        //Trader 2 will create another limit order for 10 REP tokens for a price of 9/per, should be 3rd place in our list
        await dex.createLimitOrder(REP, web3.utils.toWei('10'), 9, SIDE.BUY, {from: trader2}); 
        buyOrders = await dex.getOrders(REP, SIDE.BUY);
        sellOrders = await dex.getOrders(REP, SIDE.SELL);

        // assert statements to validate that the second order was added in the correct order with correct data and nothing was added to sell orders
        assert(buyOrders.length === 3);
        assert(buyOrders[0].trader === trader2);
        assert(buyOrders[1].trader === trader1);
        assert(buyOrders[2].trader === trader2);
        assert(buyOrders[2].price === '9');
        assert(sellOrders.length === 0);
    });

    // Testing unhappy path where user tries to buy token not traded on exchange
    // does not need initial deposit because token validation is before balance check
    it('should not create a limit order for token that does not exist', async () => {
        await expectRevert(
            dex.createLimitOrder(
                web3.utils.fromAscii('TOKEN-DOES-NOT-EXIST'),
                web3.utils.toWei('10'),
                10,
                SIDE.BUY,
                {from: trader1}
            ),
            'this token does not exist'
        );
    });

    // Testing unhappy path where user tries to buy DAI (DAI can only be gained through SELL orders), 
    // does not need initial deposit because check for DAI order is before balance check
    it('should not create a limit order for DAI', async () => {
        await expectRevert(
            dex.createLimitOrder(
                DAI,
                web3.utils.toWei('10'),
                10,
                SIDE.BUY,
                {from: trader1}
            ),
            'cannot trade DAI'
        );
    });

    // Testing unhappy path where user tries to sell more than their token balance
    it('should not create a limit order if token balance is too low', async () => {
        await dex.deposit(web3.utils.toWei('99'), REP, {from: trader1});
        await expectRevert(
            dex.createLimitOrder(
                REP,
                web3.utils.toWei('100'),
                10,
                SIDE.SELL,
                {from: trader1}
            ),
            'token balance too low'
        );
    });

    // Testing unhappy path where user tries to buy more than their DAI balance
    it('should not create a limit order if DAI balance is too low', async () => {
        await dex.deposit(web3.utils.toWei('99'), DAI, {from: trader1});
        expectRevert(
            dex.createLimitOrder(
                REP,
                web3.utils.toWei('10'),
                10,
                SIDE.BUY,
                {from: trader1}
            ),
            'DAI balance too low'
        );
    });

    

});