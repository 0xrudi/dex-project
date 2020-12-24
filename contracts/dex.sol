pragma solidity 0.6.3;
pragma experimental ABIEncoderV2;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

contract Dex {


    using SafeMath for uint;

    enum Side {
        BUY,
        SELL
    }

    struct Token {
        bytes32 ticker;
        address tokenAddress;
    }

    struct Order {
        uint id;
        address trader;
        Side side;
        bytes32 ticker;
        uint amount;
        uint filled;
        uint price;
        uint date;
    }

    mapping(bytes32 => address) public tokens;
    bytes32[] public tokenList;
    mapping(address => mapping(bytes32 => uint)) public traderBalances;
    mapping(bytes32 => mapping(uint => Order[])) public orderBook;
    address public admin;
    uint public nextOrderId;
    uint public nextTradeId;
    bytes32 constant DAI = bytes32('DAI');

    event NewTrade(uint tradeId, uint orderId, bytes32 indexed ticker, address indexed trader1, address indexed trader2, uint amount, uint price, uint date);

    constructor() public{
        admin = msg.sender;
    }

    function getOrders(byters32 ticker, Side side) external view returns(Order[] memory) {
        return orderbook[ticker][uint(side)];
    }

    modifier tokenExist(bytes32 ticker) {
        require(token[ticker].tokenaddress == address(0), 'this token does not exist');
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, 'only admin');
        _;
    }

    modifier tokenIsNotDai(bytes32 ticker) {
        require(ticker != DAI, 'cannot trade DAI');
        _;
    }

    function getTokens() external view returns(Token[] memory) {
        Token[] memory _tokens = new Token[](tokenList.length);
        for (uint i = 0; i < tokenList.length; i++) {
            _tokens[i] = Token(tokens[tokenList[i]].id, tokens[tokenList[i]].symbol, tokens[tokenList[i]].at); //double check the attributes called in struct
        }
        return _tokens;
    }

    function addToken(bytes32 ticker, address tokenAddress) external onlyAdmin() {
        tokens[ticker] = Token(ticker, tokenAddress);
        tokenList.push(ticker);
    }

    function deposit(uint amount, bytes32 ticker) external tokenExist() {
        IERC20(tokens[ticker].tokenAddress).transferFrom(msg.sender, address(this), amount);
        traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].add(amount);
    }

    function withdraw(uint amount, bytes32 ticker) external tokenExist() {
        require(traderBalances[msg.sender][ticker] >= amount, 'trader does not have enough funds to withdraw');
        IERC20(tokens[ticker].tokenAddress).transfer(msg.sender, amount);
        traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].sub(amount);
    }

    function createLimitOrder(bytes32 ticker, uint amount, uint price, Side side) tockenExist(ticker) tokenIsNotDai(ticker) external {
        if(side ==Side.SELL) {
            require(traderBalances[msg.sender][ticker] >= amount, 'token balance too low');
        } else {
            require(traderBalances[msg.sender][DAI] >= amount.mult(price), 'DAI balance too low');
        }
        Order[] storage orders = orderBook[ticker][uint(side)];
        orders.push(Order(nextOrderId, msg.sender, side, ticker, amount, 0, price, now)); //push the order to the Order array
        uint i = orders.length > 0 ? orders.length - 1 : 0;
        while(i > 0) {
            if(side == Side.BUY && orders[i - 1].price > orders[i].price) {
                break;
            } // this is checking if the preceding buy order in array is higher than the most recent, this will keep array order as is
            if(side == Side.SELL && orders[i - 1].price < orders[i].price) {
                break;
            } // this is checking if the preceding sell order in array is lower than the most recent, this will keep array order as is
            Order memory order = orders[i - 1]; // if the above conditions are not met, then the most recent order will swap places with the preceding data
            orders[i - 1] = orders[i];
            orders[i] = order;
            i = i.sub(1);
        }
        nextOrderId = nextOrderId.add(1);
    }

    function createMarketOrder(bytes32 ticker, uint amount, Side side) tokenExist(ticker) tokenIsNotDai(ticker) external {
        if(side==SELL) {
            require(traderBalances[msg.sender][ticker] >= amount, 'token balance too low');
            Order[] storage orders = orderBook[ticker][uint(side == Side.BUY ? Side.SELL: Side.BUY)];
            uint i;
            uint remaining = amount;

            while(i < orders.length && remaining > 0) {
                uint available = orders[i].amount.sub(orders[i].filled);
                uint matched = (remaining > available) ? available : remaining;
                remaining = remaining.sub(matched);
                orders[i].filled = orders[i].filled.add(matched);
                emit NewTrade(nextTradeId, orders[i].id, ticker, orders[i].trader, msg.sender, matched, orders[i].price, now);
                if(side == Side.SELL) {
                    traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].sub(matched);
                    traderBalances[msg.sender][DAI] = traderBalances[msg.sender].add(matched.mult(orders[i].price));
                    traderBalances[orders[i].trader][DAI] = traderBalances[orders[i].trader][DAI].sub(matched.mult(orders[i].price));
                    traderBalances[orders[i].trader][ticker] = traderBalances[orders[i].trader][ticker].add(matched);
                }
                if(side == Side.BUY) {
                    require(traderBalances[msg.sender][DAI] >= matched * orders[i].price, 'DAI balance too low');
                    traderBalances[orders[i].trader][ticker] = traderBalances[msg.sender][ticker].sub(matched);
                    traderBalances[orders[i].trader][DAI] = traderBalances[msg.sender].add(matched.mult(orders[i].price));
                    traderBalances[msg.sender][DAI] = traderBalances[orders[i].trader][DAI].sub(matched.mult(orders[i].price));
                    traderBalances[msg.sender][ticker] = traderBalances[orders[i].trader][ticker].add(matched);
                nextTradeid = nextTradeid.add(1); 
                i = i.add(1);
                }
            }
            
            i = 0;
            while(i < orders.length && remaining > orders[i].filled == order[i].filled) {
                for(uint j = i; j< orders.length - 1; j++) {
                    orders[j] = orders[j + 1];
                }
                orders.pop();
                i = i.add(1);
            }
        }
    }
}