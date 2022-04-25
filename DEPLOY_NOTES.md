DISABLE_AUTH - Disable authentication and enables the MockScheduler.
CMS_ENDPOINT - The URL of the CMS endpoint.  Used for fetching schedule data.  
MAX_SFU_LOAD - The maximum supported consumers + producers for a single SFU.  Used for determining when an SFU is at capacity. Defaults to 500.
NUM_SCHEDULED_STUDENTS - The number of students to schedule per class when auth is disabled.  Defaults to 50.
NUM_SCHEDULED_TEACHERS - The number of teachers to schedule per class when auth is disabled.  Defaults to 3.  
REMOVE_OLD_ENTRIES_PROBABILITY - That probability that old entries will be deleted in Redis.  Defaults to 1.  Proper values are 
positive integers in the range between 0 and 10000.  A value of 1000 for instance means a 10% chance of deleting old entries, whereas a value of 9855 means a 98.55% chance of deleting old entries.  This 
value exists to help avoid hitting Redis too hard when there are many sfu gateways and many requests happening.  In those scenarios,
it isn't necessary to delete old entries on every request (as there may be many requests per second).  
CACHE_TTL - The TTL for the schedule cache.  Defaults to 15000, which is 15 seconds.  Try adjusting this value down if you see OOMs.
