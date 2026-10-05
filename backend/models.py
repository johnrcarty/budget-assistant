import re
from datetime import date as CalendarDate
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator


Scope = Literal['household', 'personal']


class Setup(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=200)
    household_name: str = Field(default='Our household', min_length=1, max_length=80)
    timezone: str = 'America/New_York'

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError:
            raise ValueError('Choose a valid timezone')
        return value

    @field_validator('username')
    @classmethod
    def valid_username(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[a-z0-9_.@-]{2,64}', value):
            raise ValueError('Use letters, numbers, dots, underscores, or hyphens')
        return value


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class Member(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=200)

    _valid_username = field_validator('username')(Setup.valid_username.__func__)


class BudgetItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    budget_category_id: int | None = Field(default=None, ge=1, strict=True)
    group_name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    planned_cents: int = Field(default=0, ge=0, le=10**12, strict=True)

    @field_validator('name', 'group_name')
    @classmethod
    def nonblank_text(cls, value):
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError('Enter a name')
        return value

    @model_validator(mode='after')
    def category_required(self):
        if self.budget_category_id is None and self.group_name is None:
            raise ValueError('Choose a budget category')
        return self


class BudgetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    budget_category_id: int | None = Field(default=None, ge=1, strict=True)
    group_name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    planned_cents: int | None = Field(default=None, ge=0, le=10**12, strict=True)

    _nonblank_text = field_validator('name', 'group_name')(BudgetItem.nonblank_text.__func__)


class BudgetCategory(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(default='#4f766b', pattern=r'^#[0-9a-fA-F]{6}$')
    active: bool = True

    _nonblank_name = field_validator('name')(BudgetItem.nonblank_text.__func__)


class BudgetCategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    active: bool | None = None

    _nonblank_name = field_validator('name')(BudgetItem.nonblank_text.__func__)


class ItemDue(BaseModel):
    due_day: int | Literal['last'] | None
    existing_bill_id: int | None = Field(default=None, ge=1, strict=True)

    @field_validator('due_day', mode='before')
    @classmethod
    def valid_day(cls, value):
        if value is not None and value != 'last' and (type(value) is not int or not 1 <= value <= 31):
            raise ValueError('Choose a day between 1 and 31, or last')
        return value


class ItemPayment(BaseModel):
    paid: bool


class ItemTransactionLink(BaseModel):
    replace_existing: bool = False


class ItemTransaction(BaseModel):
    description: str = Field(min_length=1, max_length=300)
    amount_cents: int = Field(ge=-(10**12), le=10**12, strict=True)
    date: CalendarDate
    account_name: str = Field(default='Manual entry', min_length=1, max_length=120)
    account_id: int | None = Field(default=None, ge=1, strict=True)
    pending: bool = False

    _nonblank_text = field_validator('description', 'account_name')(BudgetItem.nonblank_text.__func__)


class BudgetCopy(BaseModel):
    from_month: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    to_month: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    scope: Scope = 'household'


class Income(BaseModel):
    scope: Scope = 'household'
    month: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    amount_cents: int = Field(ge=0, le=10**12, strict=True)


class IncomeEntry(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount_cents: int = Field(ge=0, le=10**12, strict=True)
    date: CalendarDate | None = None
    replace_legacy: bool = False


class IncomeEntryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    amount_cents: int | None = Field(default=None, ge=0, le=10**12, strict=True)
    date: CalendarDate | None = None


class IncomeSource(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount_cents: int = Field(ge=0, le=10**12, strict=True)
    cadence: Literal['once', 'weekly', 'biweekly', 'semimonthly', 'monthly']
    anchor_date: CalendarDate
    effective_from: CalendarDate | None = None
    day1: int | Literal['last'] = 15
    day2: int | Literal['last'] = 'last'
    replace_legacy: bool = False

    @field_validator('day1', 'day2')
    @classmethod
    def valid_day(cls, value):
        if value != 'last' and (isinstance(value, bool) or not 1 <= value <= 31):
            raise ValueError('Choose a day between 1 and 31, or last')
        return value

    @model_validator(mode='after')
    def different_days(self):
        if self.cadence == 'semimonthly' and self.day1 == self.day2:
            raise ValueError('Choose two distinct days for twice monthly income')
        return self


class IncomeSourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    amount_cents: int | None = Field(default=None, ge=0, le=10**12, strict=True)
    cadence: Literal['once', 'weekly', 'biweekly', 'semimonthly', 'monthly'] | None = None
    anchor_date: CalendarDate | None = None
    effective_from: CalendarDate | None = None
    day1: int | Literal['last'] | None = None
    day2: int | Literal['last'] | None = None

    _valid_day = field_validator('day1', 'day2')(lambda value: value if value is None else IncomeSource.valid_day(value))


class Bill(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    amount_cents: int = Field(ge=0, le=10**12, strict=True)
    due_date: CalendarDate
    paid: bool = False
    autopay: bool = False
    recurrence: Literal['none', 'monthly'] = 'none'


class BillPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    amount_cents: int | None = Field(default=None, ge=0, le=10**12, strict=True)
    due_date: CalendarDate | None = None
    paid: bool | None = None
    autopay: bool | None = None
    recurrence: Literal['none', 'monthly'] | None = None


class Transaction(BaseModel):
    description: str = Field(min_length=1, max_length=300)
    amount_cents: int = Field(ge=-(10**12), le=10**12, strict=True)
    date: CalendarDate
    account_name: str = Field(default='Manual entry', min_length=1, max_length=120)
    account_id: int | None = Field(default=None, ge=1, strict=True)
    category_id: int | None = None
    pending: bool = False


class TransactionPatch(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=300)
    amount_cents: int | None = Field(default=None, ge=-(10**12), le=10**12, strict=True)
    date: CalendarDate | None = None
    account_name: str | None = Field(default=None, min_length=1, max_length=120)
    account_id: int | None = Field(default=None, ge=1, strict=True)
    category_id: int | None = None
    pending: bool | None = None


class CategorizationRule(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    merchant_text: str = Field(min_length=1, max_length=200)
    match_type: Literal['contains', 'exact'] = 'contains'
    direction: Literal['outflow', 'inflow', 'any'] = 'outflow'
    account_id: int | None = Field(default=None, ge=1, strict=True)
    budget_item_id: int = Field(ge=1, strict=True)
    active: bool = True

    _nonblank_text = field_validator('name', 'merchant_text')(BudgetItem.nonblank_text.__func__)


class CategorizationRulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    merchant_text: str | None = Field(default=None, min_length=1, max_length=200)
    match_type: Literal['contains', 'exact'] | None = None
    direction: Literal['outflow', 'inflow', 'any'] | None = None
    account_id: int | None = Field(default=None, ge=1, strict=True)
    budget_item_id: int | None = Field(default=None, ge=1, strict=True)
    active: bool | None = None

    _nonblank_text = field_validator('name', 'merchant_text')(BudgetItem.nonblank_text.__func__)


class CategorizationRuleOrder(BaseModel):
    rule_ids: list[int] = Field(max_length=500)

    @field_validator('rule_ids', mode='before')
    @classmethod
    def strict_ids(cls, value):
        if not isinstance(value, list) or any(type(rule_id) is not int or rule_id < 1 for rule_id in value):
            raise ValueError('Use positive rule IDs')
        return value


class CategorizationPreview(BaseModel):
    month: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')


class CategorizationApply(BaseModel):
    preview_token: str = Field(min_length=20, max_length=200)


class Account(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    institution: str = Field(default='', max_length=120)
    kind: Literal['checking', 'savings', 'credit', 'investment', 'loan', 'property', 'other'] = 'checking'
    balance_cents: int = Field(default=0, ge=-(10**14), le=10**14, strict=True)
    currency: str = Field(default='USD', pattern=r'^[A-Z]{3}$')
    original_balance_cents: int | None = Field(default=None, ge=0, le=10**14, strict=True)
    apr_basis_points: int | None = Field(default=None, ge=0, le=100000, strict=True)
    debt_type: Literal['mortgage', 'auto', 'student', 'personal', 'credit_card', 'line_of_credit', 'other'] | None = None
    opened_date: CalendarDate | None = None
    term_months: int | None = Field(default=None, ge=1, le=1200, strict=True)
    notes: str | None = Field(default=None, max_length=2000)


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    kind: Literal['checking', 'savings', 'credit', 'investment', 'loan', 'property', 'other'] | None = None
    balance_cents: int | None = Field(default=None, ge=-(10**14), le=10**14, strict=True)
    currency: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')
    original_balance_cents: int | None = Field(default=None, ge=0, le=10**14, strict=True)
    apr_basis_points: int | None = Field(default=None, ge=0, le=100000, strict=True)
    debt_type: Literal['mortgage', 'auto', 'student', 'personal', 'credit_card', 'line_of_credit', 'other'] | None = None
    opened_date: CalendarDate | None = None
    term_months: int | None = Field(default=None, ge=1, le=1200, strict=True)
    notes: str | None = Field(default=None, max_length=2000)


class DebtPaymentSchedule(BaseModel):
    amount_cents: int = Field(ge=0, le=10**12, strict=True)
    cadence: Literal['weekly', 'biweekly', 'semimonthly', 'monthly']
    anchor_date: CalendarDate
    day1: int | Literal['last'] = 15
    day2: int | Literal['last'] = 'last'
    active: bool = True
    effective_from: CalendarDate | None = None

    _valid_day = field_validator('day1', 'day2')(IncomeSource.valid_day.__func__)

    @model_validator(mode='after')
    def different_days(self):
        if self.cadence == 'semimonthly' and self.day1 == self.day2:
            raise ValueError('Choose two distinct payment days')
        return self


class Settings(BaseModel):
    share_personal_totals: bool | None = None
    sync_interval_hours: int | None = Field(default=None, ge=1, le=168, strict=True)


class SimpleFINConnect(BaseModel):
    setup_token: str = Field(min_length=1, max_length=10000)
    scope: Scope = 'household'


class SimpleFINSync(BaseModel):
    scope: Scope = 'household'
